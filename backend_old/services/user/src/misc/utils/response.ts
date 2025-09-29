export function sendSuccess(res: any, data: any) {
  return res.status(200).json({ success: true, data });
}

export function sendError(res: any, message = 'Internal server error', status = 500) {
  return res.status(status).json({ success: false, error: message });
}