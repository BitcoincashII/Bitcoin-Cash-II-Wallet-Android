import Bugsnag from '@bugsnag/react-native';
import { getUniqueId } from 'react-native-device-info';

import { BlueApp as BlueAppClass } from '../class';

const BlueApp = BlueAppClass.getInstance();

let userHasOptedOut: boolean = false;
let bugsnagAvailable: boolean = false;

(async () => {
  try {
    bugsnagAvailable = Bugsnag.isStarted();
  } catch {
    bugsnagAvailable = false;
  }

  if (!bugsnagAvailable) return;

  const doNotTrack = await BlueApp.isDoNotTrackEnabled();
  if (doNotTrack) {
    userHasOptedOut = true;
    return;
  }

  const uniqueID = await getUniqueId();
  Bugsnag.setUser(uniqueID);
  Bugsnag.addOnError(function (event) {
    return !userHasOptedOut;
  });
})();

const A = async (event: string) => {};

A.setOptOut = (value: boolean) => {
  if (value) userHasOptedOut = true;
};

A.logError = (errorString: string) => {
  console.error(errorString);
  if (bugsnagAvailable && !userHasOptedOut) {
    try {
      Bugsnag.notify(new Error(String(errorString)));
    } catch {}
  }
};

export default A;
