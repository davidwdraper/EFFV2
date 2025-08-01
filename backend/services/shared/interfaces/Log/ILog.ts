// shared/interfaces/Log/ILog.ts
export interface ILogFields {
  timeCreated: string;
  logType: number;
  logSeverity: number;
  message: string;
  path?: string;
  userId?: string;
  entityName?: string;
  entityId?: string;
  service?: string;
  sourceFile?: string;
  sourceLine?: number;
}

export interface ILog extends ILogFields {
  _id: string; // This is for frontend use, not mixed with Mongoose
}
