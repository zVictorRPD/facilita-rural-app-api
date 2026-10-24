import "dotenv/config";
import { app } from "../src/app.js";

export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
