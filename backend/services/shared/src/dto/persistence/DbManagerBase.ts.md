// backend/services/shared/src/dto/persistence/DbManagerBase.ts
/**
 * Docs:
 * - ADR-0040/0041/0042/0043
 *
 * Purpose:
 * - Abstract base for DTO persistence managers.
 * - Receives a DTO instance and **SvcEnvDto** via DI.
 * - Subclasses (e.g., DbWriter) use svcEnv getters to connect.
 */

import type { BaseDto } from "../DtoBase"; // if file is here adjust path accordingly
import type { SvcEnvDto } from "../svcenv.dto";

export abstract class DbManagerBase<TDto extends BaseDto> {
  protected readonly _dto: TDto;
  protected readonly _svcEnv: SvcEnvDto;

  constructor(params: { dto: TDto; svcEnv: SvcEnvDto }) {
    this._dto = params.dto;
    this._svcEnv = params.svcEnv;
  }
}
