const jwt = require("jsonwebtoken");
const User = require("./User");
require("dotenv").config();


module.exports = async (req, res, next) => {
  const token = req.cookies.token;

  console.log("Token received:", token); // Log the received token

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;

    const user = await User.findById(req.user.id);
    req.user.threadId = user.threadId;

    console.log("Decoded user:", req.user); // Log the decoded user information

    next();
  } catch (err) {
    console.error("Token verification failed:", err.message); // Log the error
    res.status(401).json({ msg: "Token is not valid" });
  }
};
