// start by calling:
// node .\example.mjs

import fetch from './index.js';
import {enableDebugLogging} from './index.js';

enableDebugLogging(true);

// Has eTags and other cache headers
const urlToRequest = 'https://cacheheadertestingapi.azurewebsites.net/CacheHeaderTest?okResponseTimeMs=150&notModifiedResponseTimeMs=50&maxAge=180&sMaxAge=60&staleWhileRevalidate=80&staleWhileError=300&eTag=foo&age=5';
// has LastModified
//const urlToRequest = 'https://cacheheadertestingapi.azurewebsites.net/CacheHeaderTest/LastModified?okResponseTimeMs=200&notModifiedResponseTimeMs=50&maxAge=180&sMaxAge=60&staleWhileRevalidate=80&staleWhileError=300&lastModified=Fri%2C%201%20Apr%202022%2016%3A52%3A15%20GMT&age=5';
const timesToCallEndpoint = 30;
const secondsDelayBetweenCalls = 20;

console.log(`Requesting ${urlToRequest} ${timesToCallEndpoint} times in ${secondsDelayBetweenCalls} second intervals, ctrl + c to end
`);
let requestNo = 1;

async function callEndpoint() {
    const timingKey = "Request " + requestNo + " time";
    console.time(timingKey);
    const response = await fetch(urlToRequest);
    console.timeEnd(timingKey);
    const age = response.headers.get("Age");
    console.log(`Status: ${response.status}, Age: ${age} at ${new Date()}`);
    requestNo++;
}

for (let i = 1; i <= timesToCallEndpoint; i++) {
    setTimeout(async () => {
        await callEndpoint();
    }, i * secondsDelayBetweenCalls * 1000);
}
await callEndpoint();