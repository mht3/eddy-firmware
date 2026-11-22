import {finishScan} from './session.js';

finishScan().catch(error => {
  const message = document.getElementById('return-notice');
  message.hidden = false;
  message.textContent = error.message;
});
