import {startBridge} from '../bridge.js';
import {scanSession, takeNotice} from '../session.js';

const session = scanSession();
if (session) startBridge(session.id, takeNotice(session));
