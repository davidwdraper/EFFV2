// backend/services/act/src/config/search.ts
import { requireNumber } from "@shared/config/env";

// Export a constant so controllers don't do env I/O
export const UNFILTERED_CUTOFF = requireNumber("ACT_SEARCH_UNFILTERED_CUTOFF");
