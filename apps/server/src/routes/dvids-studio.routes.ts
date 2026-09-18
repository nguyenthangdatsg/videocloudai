import { Router } from 'express';
import { createStudioRouter } from './script-studio.routes';
import { DVIDS_STUDIO_TABLES, ensureDvidsStudioTables } from '../services/script-studio.service';

export function createDvidsStudioRouter(): Router {
  ensureDvidsStudioTables();
  return createStudioRouter(DVIDS_STUDIO_TABLES);
}
