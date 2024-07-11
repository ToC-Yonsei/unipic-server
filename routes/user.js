const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const { verifyAccessToken, verifyRefreshToken } = require('../utils');

router.post('/login', async (req, res) => {
    const [userResult] = await db.promise().query(`
        SELECT id 
        FROM user 
        WHERE apple_id = ?
    `, [req.body.appleId]);
    let user = userResult[0];

    if (!user) {
        const id = uuidv4().slice(0, 8);
        await db.promise().query(`
            INSERT INTO user (id, apple_id) 
            VALUES (?, ?)
        `, [id, req.body.appleId]);

        const [newUserResult] = await db.promise().query(`
            SELECT id 
            FROM user 
            WHERE apple_id = ?
        `, [req.body.appleId]);
        user = newUserResult[0];
    }

    const accessToken = jwt.sign(
        { id: user.id },
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
    `, [refreshToken, user.id]);

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

module.exports = router;