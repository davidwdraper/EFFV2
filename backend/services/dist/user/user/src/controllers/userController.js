"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserByEmail = exports.createUser = void 0;
const User_1 = require("../models/User");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const createUser = async (req, res) => {
    try {
        const { eMailAddr, password, firstname, lastname, middlename, userType = 1, } = req.body;
        // 🔍 Check if email already exists
        const existing = await User_1.UserModel.findOne({ eMailAddr });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const currentEnv = process.env.NODE_ENV || 'dev';
        //const envPath = path.resolve(process.cwd(), `.env.${currentEnv}`);
        const envPath = path_1.default.resolve(__dirname, '../../../../../.env.' + currentEnv);
        dotenv_1.default.config({ path: envPath });
        console.log(`[User env] Loaded environment: ${currentEnv} from ${envPath}`);
        const now = new Date();
        // 📦 Build user data
        const userData = {
            eMailAddr,
            password,
            firstname,
            lastname,
            middlename,
            userType,
            userStatus: 0,
            dateCreated: now,
            dateLastUpdated: now,
            imageIds: [],
        };
        // 🧾 Save user (hashing + ID assignment handled by schema)
        const user = new User_1.UserModel(userData);
        await user.save();
        // 🔐 Create JWT
        const JWT_SECRET = process.env.JWT_SECRET || '2468';
        console.log("[jwt.sign] JWT_SECRET: ", JWT_SECRET);
        const token = jsonwebtoken_1.default.sign({
            _id: user._id.toString(),
            firstname: user.firstname,
            lastname: user.lastname,
            eMailAddr: user.eMailAddr,
            userType: user.userType,
        }, JWT_SECRET, { expiresIn: '100h' });
        // ✅ Return user + token
        return res.status(201).json({
            user: {
                _id: user._id,
                firstname: user.firstname,
                lastname: user.lastname,
                middlename: user.middlename,
                eMailAddr: user.eMailAddr,
                userType: user.userType,
            },
            token,
        });
    }
    catch (err) {
        console.error('[UserService] createUser error:', err);
        return res.status(500).json({ error: 'Failed to create user' });
    }
};
exports.createUser = createUser;
const getUserByEmail = async (req, res) => {
    try {
        const user = await User_1.UserModel.findOne({ eMailAddr: req.params.eMailAddr }).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    }
    catch (err) {
        console.error('[UserService] getUserByEmail error:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve user' });
    }
};
exports.getUserByEmail = getUserByEmail;
