const jwt = require("jsonwebtoken");
const token = jwt.sign(
  {
    _id: "68914aa6051a847002085924",
    userType: 3,
    lastname: "Chanley",
    middlename: "C",
    firstname: "Caren",
    eMailAddr: "caren@gmail.com",
  },
  "6969", // Use exact secret from .env
  { expiresIn: "100h" }
);
console.log(token);
