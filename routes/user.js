const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const config = require('../config/config.json');
const AppleAuth = require('apple-auth');
const { importJWK, jwtVerify } = require('jose');

const { verifyAccessToken, verifyRefreshToken } = require('../utils');

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

async function getApplePublicKeys() {
    const response = await fetch('https://appleid.apple.com/auth/keys');
    const data = await response.json();
    return data.keys;
}

async function verifyAppleToken(token) {
    const clientId = config.client_id;

    const appleKeys = await getApplePublicKeys();
    const { header } = jwt.decode(token, { complete: true });

    if (header.alg !== 'RS256') {
        throw new Error(`Unexpected algorithm ${header.alg}. Expected RS256.`);
    }

    const appleKey = appleKeys.find(key => key.kid === header.kid && key.alg === header.alg);

    if (!appleKey) {
        throw new Error('Apple public key not found for token');
    }

    const publicKey = await importJWK(appleKey, 'ES256');

    const { payload } = await jwtVerify(token, publicKey, {
        algorithms: ['RS256'],
    });

    if (payload.iss !== 'https://appleid.apple.com') {
        throw new Error('Invalid iss field');
    }

    if (payload.aud !== clientId) {
        console.log(payload.aud);
        console.log(clientId);
        throw new Error('Invalid aud field');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime >= payload.exp) {
        throw new Error('Token has expired');
    }

    console.log('Token is valid');
    console.log('Payload:', payload);

    if (payload.nonce) {
        const expectedNonce = 'expected_nonce_value';
        if (payload.nonce !== expectedNonce) {
            throw new Error('Invalid nonce');
        }
        console.log('Nonce is valid');
    }
}

router.post('/login/apple', async (req, res) => {
    try {
        // const response = await auth.accessToken(req.body.code);
        // const idToken = jwt.decode(response.id_token);
        verifyAppleToken(req.body.code);
        const idToken = jwt.decode(req.body.code);
        // jwt.verify(req.body.code, fs.readFileSync('./config/AuthKey.p8').toString(), { algorithms: ['ES256'] });

        const user = {};
        user.id = idToken.sub;

        if (idToken.email) {
            user.email = idToken.email;
        } else {
            user.email = '';
        }
        if (req.body.user) {
            const { name } = JSON.parse(req.body.user);
            user.name = name;
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
                INSERT INTO user (id, apple_id, name, email) 
                VALUES (?, ?, ?, ?)
            `, [id, user.id, user.name, user.email]);

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

        await db.promise().query(`
            UPDATE user 
            SET refresh_token = ? 
            WHERE id = ?
        `, [refreshToken, loginUser.id]);

        return res.status(200).json({
            accessToken: accessToken,
            refreshToken: refreshToken
        });
    } catch (ex) {
        console.error(ex);
        res.status(500).send("An error occurred!");
    }
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

module.exports = router;