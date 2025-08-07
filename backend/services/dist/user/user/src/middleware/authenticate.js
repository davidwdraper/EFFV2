"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthenticateMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
require("@/types/express"); // ✅ force the augmentation to load
const createAuthenticateMiddleware = (jwtSecret) => {
    if (!jwtSecret) {
        throw new Error('[Auth] JWT_SECRET is required');
    }
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (!token) {
            console.warn('[Auth] Missing token');
            return res.status(401).json({ error: 'Missing token' });
        }
        try {
            const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
            console.log('[Auth] Token verified:', decoded);
            // Basic structural validation
            if (typeof decoded === 'object' &&
                decoded &&
                '_id' in decoded &&
                'userType' in decoded &&
                'lastname' in decoded &&
                'firstname' in decoded &&
                'eMailAddr' in decoded) {
                req.user = {
                    _id: decoded._id,
                    userType: decoded.userType,
                    firstname: decoded.firstname,
                    lastname: decoded.lastname,
                    eMailAddr: decoded.eMailAddr,
                };
                return next();
            }
            else {
                console.warn('[Auth] Token payload missing required fields');
                return res.status(401).json({ error: 'Malformed token payload' });
            }
        }
        catch (err) {
            console.error('[Auth] Token verification failed:', err);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
};
exports.createAuthenticateMiddleware = createAuthenticateMiddleware;
