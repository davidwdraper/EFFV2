const jwt = require('jsonwebtoken');
const token = jwt.sign(
  {
    userType: 1,
    lastname: "Sanchez",
    firstname: "Emma",
    eMailAddr: "emma@example.com"
  },
  "2468",  // Use exact secret from .env
  { expiresIn: "100h" }
);
console.log(token);    