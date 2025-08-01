// services/shared/interfaces/Log/INewLog.ts

export interface INewLog {
  logType: number;
  logSeverity: number;
  path?: string;
  userId?: string;
  entityName?: string;
  entityId?: string;
  message: string;
}
