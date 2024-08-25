const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const config = require('../config/config.json');
const { importJWK, jwtVerify } = require('jose');
const axios = require('axios');
const qs = require('qs');

const { verifyAccessToken, verifyRefreshToken } = require('../utils');
const { verify } = require('crypto');

// router.post('/login', async (req, res) => {
//     const [userResult] = await db.promise().query(`
//         SELECT id 
//         FROM user 
//         WHERE apple_id = ?
//     `, [req.body.appleId]);
//     let user = userResult[0];

//     if (!user) {
//         const id = uuidv4().slice(0, 8);
//         await db.promise().query(`
//             INSERT INTO user (id, apple_id) 
//             VALUES (?, ?)
//         `, [id, req.body.appleId]);

//         const [newUserResult] = await db.promise().query(`
//             SELECT id 
//             FROM user 
//             WHERE apple_id = ?
//         `, [req.body.appleId]);
//         user = newUserResult[0];
//     }

//     const accessToken = jwt.sign(
//         { id: user.id },
//         process.env.JWT_SECRET_KEY,
//         { algorithm: 'HS256', expiresIn: '3h' }
//     );
//     const refreshToken = jwt.sign(
//         {},
//         process.env.JWT_SECRET_KEY,
//         { algorithm: 'HS256', expiresIn: '30d' }
//     );

//     await db.promise().query(`
//         UPDATE user 
//         SET refresh_token = ? 
//         WHERE id = ?
//     `, [refreshToken, user.id]);

//     return res.status(200).json({
//         accessToken: accessToken,
//         refreshToken: refreshToken
//     });
// });
router.post('/login', async (req, res) => {
    const algorithm = 'ES256';
    const key_id = config.key_id;
    const issuer = config.team_id;
    const expiresIn = 7776000;
    const audience = 'https://appleid.apple.com';
    const subject = config.client_id;
    const authKey = fs.readFileSync('./config/AuthKey.p8', 'utf-8');

    const client_secret = jwt.sign(
        {}, 
        authKey, 
        {
            algorithm: algorithm,
            keyid: key_id,
            issuer: issuer,
            expiresIn: expiresIn,
            audience: audience,
            subject: subject
        });

    const tokenResponse = await axios.post('https://appleid.apple.com/auth/token', qs.stringify({
        client_id: config.client_id,
        client_secret: client_secret,
        code: req.body.code,
        grant_type: 'authorization_code',
    }), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const appleRefreshToken = tokenResponse.data.refresh_token;
    const idToken = tokenResponse.data.id_token;

    const decodedIdToken = jwt.decode(idToken);

    console.log(decodedIdToken);
    
    const user = {};
    user.id = decodedIdToken.sub;

    if (decodedIdToken.email) {
        user.email = decodedIdToken.email;
    } else {
        user.email = '';
    }
    if (decodedIdToken.name) {
        user.name = decodedIdToken.name;
    } else {
        user.name = '사용자 이름';
    }

    const [userResult] = await db.promise().query(`
        SELECT id 
        FROM user 
        WHERE apple_id = ?
    `, [user.id]);
    let loginUser = userResult[0];

    if (!loginUser) {
        const id = uuidv4().slice(0, 8);
        await db.promise().query(`
            INSERT INTO user (id, apple_id, name, email, apple_refresh_token) 
            VALUES (?, ?, ?, ?, ?)
        `, [id, user.id, user.name, user.email, appleRefreshToken]);

        const [newUserResult] = await db.promise().query(`
            SELECT id 
            FROM user 
            WHERE apple_id = ?
        `, [user.id]);
        loginUser = newUserResult[0];
    }

    const accessToken = jwt.sign(
        { id: loginUser.id },
        process.env.JWT_SECRET_KEY,
        { algorithm: 'HS256', expiresIn: '3h' }
    );
    const refreshToken = jwt.sign(
        {},
        process.env.JWT_SECRET_KEY,
        { algorithm: 'HS256', expiresIn: '30d' }
    );

    const currentTime = Date.now().toString();

    await db.promise().query(`
        UPDATE user 
        SET refresh_token = ?, 
        last_login = ?,
        apple_refresh_token = ?
        WHERE id = ?
    `, [refreshToken, currentTime, loginUser.id, appleRefreshToken]);

    return res.status(200).json({
        accessToken: accessToken,
        refreshToken: refreshToken
    });
});

router.get("/refresh-token", verifyRefreshToken, async (req, res, next) => {
    const [user] = await db.promise().query(`
        SELECT id 
        From user 
        WHERE refresh_token = ?
    `, [res.locals.refreshToken]);

    if (user.length == 0) {
        return res.status(404).json({ message: "존재하지 않는 회원입니다." });
    }

    const accessToken = jwt.sign(
        { id: user[0].id },
        `${process.env.JWT_SECRET_KEY}`,
        { algorithm: 'HS256', expiresIn: '3h' }
    );
    const refreshToken = jwt.sign(
        {},
        `${process.env.JWT_SECRET_KEY}`,
        { algorithm: 'HS256', expiresIn: '30d' }
    );

    await db.promise().query(`
        UPDATE user 
        SET refresh_token = ?
        WHERE id = ?
    `, [refreshToken, user[0].id]);

    return res.status(200).json({
        accessToken: accessToken,
        refreshToken: refreshToken,
    });
});


router.put('/change-name', verifyAccessToken, async (req, res) => {
    await db.promise().query(`
        UPDATE user 
        SET name = ? 
        WHERE id = ?
    `, [req.body.name, res.locals.id]);

    return res.status(200).json({ message: "이름 변경 성공" });
});

router.get('/my-info', verifyAccessToken, async (req, res) => {
    const [user] = await db.promise().query(`
        SELECT name
        FROM user 
        WHERE id = ?
    `, [res.locals.id]);

    const [images] = await db.promise().query(`
        SELECT img_url
        FROM generate 
        WHERE user_id = ?
    `, [res.locals.id]);

    const imageUrls = [];
    images.forEach((image) => {
        imageUrls.push(image.img_url);
    });

    return res.status(200).json({ name: user[0].name, images: imageUrls });
});

router.get('/remaining-count', verifyAccessToken, async (req, res) => {
    const [user] = await db.promise().query(`
        SELECT remaining_count
        FROM user 
        WHERE id = ?
    `, [res.locals.id]);

    return res.status(200).json({ remainingCount: user[0].remaining_count });
});

router.delete('/logout', verifyAccessToken, async (req, res) => {
    await db.promise().query(`
        UPDATE user 
        SET refresh_token = NULL 
        WHERE id = ?
    `, [res.locals.id]);

    return res.status(200).json({ message: "로그아웃 성공" });
});

router.delete('/signout', verifyAccessToken, async (req, res) => {
    const [user] = await db.promise().query(`
        select apple_refresh_token
        from user
        where id = ?
    `, [res.locals.id]);

    if (user.length == 0) {
        return res.status(404).json({ message: "존재하지 않는 회원입니다." });
    }

    const algorithm = 'ES256';
    const key_id = config.key_id;
    const issuer = config.team_id;
    const expiresIn = 7776000;
    const audience = 'https://appleid.apple.com';
    const subject = config.client_id;
    const authKey = fs.readFileSync('./config/AuthKey.p8', 'utf-8');

    const client_secret = jwt.sign(
        {}, 
        authKey, 
        {
            algorithm: algorithm,
            keyid: key_id,
            issuer: issuer,
            expiresIn: expiresIn,
            audience: audience,
            subject: subject
        });

    await axios.post('https://appleid.apple.com/auth/revoke', 
        qs.stringify({
            client_id: config.client_id,
            client_secret: client_secret,
            token: user[0].apple_refresh_token,
            token_type_hint: 'refresh_token',
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    const currentTime = Date.now().toString();
    await db.promise().query(`
        INSERT INTO signout_user (id, signout_date) 
        VALUES (?, ?)
    `, [res.locals.id, currentTime]);

    return res.status(200).json({ message: "회원 탈퇴 성공" });
});

module.exports = router;