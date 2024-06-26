require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const userRoute = require('./routes/user');
const generateRoute = require('./routes/generate');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended : false}));

app.use('/user', userRoute);
app.use('/generate', generateRoute);

const port = 3000;



app.listen(port, () => {
    console.log("서버 시작");
})