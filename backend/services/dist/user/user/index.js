"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts
const app_1 = __importDefault(require("./src/app"));
const config_1 = require("./src/config");
const PORT = process.env.USER_PORT || config_1.config.port || 4001;
app_1.default.listen(PORT, () => {
    console.log(`User service running on port ${PORT}`);
});
