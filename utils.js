require("dotenv").config();
const jwt = require('jsonwebtoken');

const verifyAccessToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(400).json({ message: "토큰이 존재하지 않습니다." });
    }
    try {
        const data = jwt.verify(
            req.headers.authorization.replace("Bearer ", ""),
            process.env.JWT_SECRET_KEY,
        );
        res.locals.id = data.id;
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(419).json({ message: "만료된 액세스 토큰입니다.", code: "expired" });
        }
        return res.status(401).json({ message: "유효하지 않은 액세스 토큰입니다." });
    }
    next();
    return;
};

const verifyRefreshToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(400).json({ message: "토큰이 존재하지 않습니다." });
    }
    try {
        jwt.verify(
            req.headers.authorization.replace("Bearer ", ""),
            process.env.JWT_SECRET_KEY,
        );
        res.locals.refreshToken = req.headers.authorization.replace("Bearer ", "");
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(420).json({ message: "만료된 리프레시 토큰입니다.", code: "expired" });
        }
        return res.status(401).json({ message: "유효하지 않은 리프레시 토큰입니다." });
    }
    next();
};

module.exports = { verifyAccessToken, verifyRefreshToken };