import baseConfig from '@kit/eslint-config/base.js';
import { modelGatewayExemption } from '@kit/eslint-config/model-boundary.js';

// The door itself (FILM-1902): the one place the model client package and
// the model SDKs may be imported
export default [...baseConfig, modelGatewayExemption];
