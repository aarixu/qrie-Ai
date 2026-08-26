// Public surface of @ai-tutor/action-player. See README.md for the contract.
export { initialBoard, WB_HEIGHT, WB_SCALE_Y, type BoardState } from './state';
export { reduce } from './reduce';
export { isBlocking, nextBoundary } from './schedule';
export { ActionController, type PlaybackState, type ControllerEvent } from './controller';
export { useActionPlayer, type ActionPlayerHandle } from './useActionPlayer';
