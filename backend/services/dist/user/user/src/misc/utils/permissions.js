"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canEdit = canEdit;
function canEdit(currentUser, entityOwnerId) {
    return currentUser.userType >= 3 || currentUser._id === entityOwnerId;
}
