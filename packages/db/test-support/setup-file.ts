import { afterAll, beforeAll } from "vitest";
import { useFreshDatabase } from "./shared-pg.ts";

useFreshDatabase({ beforeAll, afterAll });
