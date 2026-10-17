// The checkout content script: runs in every frame of every page once checkout access is granted.
import { startCheckout } from './main.ts';

startCheckout(window);
