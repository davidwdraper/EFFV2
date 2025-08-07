"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const User_1 = require("../models/User");
const authenticate_1 = require("../middleware/authenticate");
const env_1 = require("./shared/env"); // adjust path if needed
const logger_1 = require("@shared/utils/logger");
const userController_1 = require("../controllers/userController");
const router = express_1.default.Router();
// Inject JWT_SECRET into middleware
const authenticate = (0, authenticate_1.createAuthenticateMiddleware)(env_1.JWT_SECRET);
// 🛡️ POST - Create a user (anonymous/public)
router.post('/', userController_1.createUser);
// 🔍 GET - Get user by email (public)
router.get('/email/:eMailAddr', userController_1.getUserByEmail);
// 📋 GET - Get all users (public)
router.get('/', async (req, res) => {
    try {
        const users = await User_1.UserModel.find();
        res.status(200).json(users);
    }
    catch (err) {
        console.error('[User] GET / - Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// 📄 GET - Get user by ID (public)
router.get('/:id', async (req, res) => {
    try {
        logger_1.logger.debug("[User] GET/id: " + req.params.id);
        console.log("[User] GET/id: ", req.params.id);
        const user = await User_1.UserModel.findById(req.params.id);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.status(200).json(user);
    }
    catch (err) {
        console.error('[User] GET /:id - Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ✏️ PUT - Update user by ID (protected)
router.put('/:id', authenticate, async (req, res) => {
    try {
        const user = await User_1.UserModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.status(200).json(user);
    }
    catch (err) {
        console.error('[User] PUT /:id - Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ❌ DELETE - Delete user by ID (protected)
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const result = await User_1.UserModel.findByIdAndDelete(req.params.id);
        if (!result)
            return res.status(404).json({ error: 'User not found' });
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error('[User] DELETE /:id - Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
