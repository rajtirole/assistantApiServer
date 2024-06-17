const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  authToken: {
    type: String,
  },
  threadId: {
    type: String,
    default:'0'
  },
});

module.exports = mongoose.model("User", UserSchema);
