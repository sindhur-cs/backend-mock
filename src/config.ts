import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT;
const apiKey = process.env.API_KEY;
const mail = process.env.MAIL;
const password = process.env.PASSWORD;
const baseUrl = process.env.BASE_URL;

export { PORT, apiKey, mail, password, baseUrl };