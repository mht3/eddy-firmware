import {finishSignIn} from './session.js?v=iphone';

try {
  finishSignIn();
} catch (error) {
  const message = document.getElementById('return-notice');
  message.hidden = false;
  message.textContent = error.message;
}
