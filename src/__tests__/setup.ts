// Runs before each test file (see setupFiles in jest.config.js).
// jsdom doesn't have TextEncoder/TextDecoder, which React Router needs, so borrow Node's.
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextEncoder, TextDecoder });
