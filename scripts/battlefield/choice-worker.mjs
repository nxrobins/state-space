import { choiceResponder } from './choices.mjs';
const respond = choiceResponder((reply) => self.postMessage(reply));
self.onmessage = ({ data }) => respond(data);
