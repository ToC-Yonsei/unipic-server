const express = require('express');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');
const axios = require('axios');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const { verifyAccessToken } = require('../utils');

const s3 = new aws.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    region: process.env.AWS_REGION
});

const uploadImage = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET,
        acl: 'public-read',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key(req, file, cb) {
            cb(null, `${uuidv4()}`)
         },
    }),
    // 이미지 용량 제한 (5MB)
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

const deleteImage = async (imgUrl) => {
    const key = imgUrl.split('/').slice(-1)[0];
    await s3.deleteObject({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key
    }).promise();
}

const uploadResult = async (imageUrl) => {
    const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream'
    });

    const key = `result/${uuidv4()}`;

    const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: response.data,
        ACL: 'public-read',
        ContentType: response.headers['content-type']
    };

    return new Promise((resolve, reject) => {
        s3.upload(uploadParams, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.Location);
            }
        });
    });
};


router.post('/', verifyAccessToken, uploadImage.array('image', 10), async(req, res) => {
    try{
        const imageUrls = [];
        req.files.forEach((file) => {
            imageUrls.push(file.location);
        });
        console.log(imageUrls);
        console.log(req.body.university);
        console.log(req.body.gender);
        console.log(req.body.faceType);
        console.log(req.body.hairStyle);

        // const response = await axios.get(`${process.env.WEB_UI_URL}/faceswaplab/version`);
        // console.log(response.data);

        const resultImg = await uploadResult(imageUrls[0]);

        await db.promise().query(`
            INSERT INTO generate (user_id, img_url) 
            VALUES (?, ?)
        `, [res.locals.id, resultImg]);

        await db.promise().query(`
            UPDATE user
            SET remaining_count = remaining_count - 1
            WHERE id = ?
        `, [res.locals.id]);

        imageUrls.forEach((url) => {
            deleteImage(url);
        });

        return res.status(201).json({ message: "이미지 등록 성공", img: resultImg });
    } catch (e) {
        console.log(e);
        return res.status(500).json({ message: " 이미지 등록 실패" });
    }
});

module.exports = router;