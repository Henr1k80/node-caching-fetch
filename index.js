// import and export what node-fetch exports
import {FormData, Headers, Request, Response, FetchError, AbortError, isRedirect, Blob, File} from "node-fetch";
import {fileFromSync, fileFrom, blobFromSync, blobFrom} from "node-fetch";

export {FormData, Headers, Request, Response, FetchError, AbortError, isRedirect};
export {Blob, File, fileFromSync, fileFrom, blobFromSync, blobFrom};

import {default as nodeFetch} from 'node-fetch';

// class CacheObject {
//     response: Response;
//     cacheKey: string;
//     url: RequestInfo;
//     options_: RequestInit;
//     canBeRevalidated: boolean;
//     mustRevalidateWhenExpired: boolean;
//     timeRevalidationMustStart: Date;
//     cachedTime: Date = new Date();
//     purgeFromCacheTimeoutID: number;
//     secondsBeforePurgingFromCache: number;
//     secondsOfAllowedFreshCache: number;
//     secondsOfServingStaleWhileError: number;
// }

const msDelayForRevalidation = 10;
const secondsDelayBeforeNextRevalidationAttempt = 10;
const secondsDelayBeforeNextRevalidationAttemptOnError = secondsDelayBeforeNextRevalidationAttempt;
const secondsAllowedInCacheWhenRequiringRevalidation = 3 * 60;
let debugLogging;

export function enableDebugLogging(value = true) {
    debugLogging = value;
}

const cache = {};

function resetTimeWhereRevalidationMustStart(cacheObject) {
    const timeRevalidationMustStart = new Date();
    timeRevalidationMustStart.setUTCMilliseconds(timeRevalidationMustStart.getUTCMilliseconds() + (cacheObject.secondsOfAllowedFreshCache * 1000));
    cacheObject.timeRevalidationMustStart = timeRevalidationMustStart;
}

function initHeaders(cacheObject) {
    if (!cacheObject.options_) {
        cacheObject.options_ = {headers: new Headers()};
    } else if (!cacheObject.options_.headers) {
        cacheObject.options_.headers = new Headers();
    }
}

function setRevalidationHeaders(cacheObject) {
    // set header for any future revalidation requests
    const etag = cacheObject.response.headers.get('etag');
    if (etag) {
        initHeaders(cacheObject);
        cacheObject.options_.headers.set('If-None-Match', etag);
        cacheObject.canBeRevalidated = true;
        if (debugLogging) {
            console.log(`Found etag: ${etag} for ${cacheObject.url}`);
        }
    } else {
        const lastModified = cacheObject.response.headers.get('Last-Modified');
        if (lastModified) {
            initHeaders(cacheObject);
            cacheObject.options_.headers.set('If-Modified-Since', lastModified);
            cacheObject.canBeRevalidated = true;
            if (debugLogging) {
                console.log(`Found Last-Modified: ${lastModified} for ${cacheObject.url}`);
            }
        }
    }
}

function storeInCacheIfCacheable(response, cacheKey, url, options_) {
    if (!response.ok) {
        // not caching, not OK response
        return;
    }
    const cacheControlHeader = response.headers.get('cache-control'); // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
    if (!cacheControlHeader || cacheControlHeader.length < 1) {
        if (debugLogging) {
            console.log(`Missing cache-control header, not caching ${url}`);
        }
        return; // no cache control header
    }
    if (cacheControlHeader.match(/\b(?:private|no-store)\b/gi)) {
        if (debugLogging) {
            console.log(`Caching not allowed, cache-control header: ${cacheControlHeader}, not caching ${url}`);
        }
        return; // caching not allowed
    }
    // we will not check the HTTP method, if the cache header permits it, it will be cached.
    // It is up the endpoint to not specify illegal stuff & caller not to use caching fetch on illegal methods
    const cacheObject = {
        cacheKey: cacheKey,
        response: response,
        url: url,
        options_: options_,
        cachedTime: new Date(),
    };
    let secondsOfAllowedCaching = 0;
    // we act like a shared cache, so s-maxage is checked first https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#s-maxage
    const sMaxAgeMatches = cacheControlHeader.match(/s-maxage=(\d+)/);
    if (sMaxAgeMatches) {
        const sMaxAge = parseInt(sMaxAgeMatches[1], 10);
        if (sMaxAge > 0) {
            secondsOfAllowedCaching = sMaxAge;
            if (debugLogging) {
                console.log(`Using s-maxage: ${sMaxAge} for ${url}`);
            }
        } else {
            return; // caching is not allowed in proxy
        }
    }
    if (secondsOfAllowedCaching < 1) {
        // check ordinary max-age https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#max-age
        const maxAgeMatches = cacheControlHeader.match(/max-age=(\d+)/);
        if (maxAgeMatches) {
            const maxAge = parseInt(maxAgeMatches[1], 10);
            if (maxAge > 0) {
                if (debugLogging) {
                    console.log(`Using max-age: ${maxAge} for ${url}`);
                }
                secondsOfAllowedCaching = maxAge;
            } else {
                return; // caching is not allowed
            }
        }
    }
    // check if the response already have an Age https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Age
    let ageInSeconds = 0;
    const ageHeader = response.headers.get('Age');
    if (ageHeader && ageHeader.length > 0) {
        ageInSeconds = parseInt(ageHeader, 10);
        if (ageInSeconds > 0) {
            cacheObject.cachedTime.setUTCMilliseconds(cacheObject.cachedTime.getUTCMilliseconds() - (ageInSeconds * 1000))
            if (debugLogging) {
                console.log(`Found existing cache age: ${ageInSeconds} seconds for ${url}`);
            }
        }
    }

    // we are allowed to cache and secondsOfAllowedCaching is positive
    setRevalidationHeaders(cacheObject);
    let secondsBeforePurgingFromCache = secondsOfAllowedCaching;
    // check if we are allowed to serve cached content without revalidating
    if (cacheControlHeader.match(/\b(?:must-revalidate|proxy-revalidate|no-cache)\b/gi)) {
        // we are allowed to cache, but there are certain rules for revalidation
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#no-cache
        if (cacheObject.canBeRevalidated) {
            // this cache needs to be revalidated with a request with either If-None-Match or If-Unmodified-Since request
            // this check can be significantly cheaper as a 304 is just an empty response and does not need to create & return response models etc.
            // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/304
            cacheObject.mustRevalidateWhenExpired = true;
            if (cacheControlHeader.match(/no-cache/)) {
                // this cache needs to be revalidated immediately
                cacheObject.secondsOfAllowedFreshCache = 0;
                if (debugLogging) {
                    console.log(`Revalidating before every use because of no-cache cache control header for ${url}`);
                }
            } else {
                // this cache can be served fresh for some time
                cacheObject.secondsOfAllowedFreshCache = secondsOfAllowedCaching - ageInSeconds;
                if (debugLogging) {
                    console.log(`Forced revalidation after ${secondsOfAllowedCaching}s because of cache control header: ${cacheControlHeader} for ${url}`);
                }
            }
            // set the cache to live some time for revalidation before being purged
            secondsBeforePurgingFromCache = cacheObject.secondsOfAllowedFreshCache + secondsAllowedInCacheWhenRequiringRevalidation - ageInSeconds;
        } else {
            // no etag or Last-Modified to revalidate against, so it makes no sense to cache, just do a regular request every time
            if (debugLogging) {
                console.log(`Not caching because there is no etag or Last-Modified to revalidate against and revalidation is required in cache control header: ${cacheControlHeader} for ${url}`);
            }
            return;
        }
    } else {
        // check if we are allowed to serve stale cached responses
        const staleWhileRevalidateMatches = cacheControlHeader.match(/stale-while-revalidate=(\d+)/);
        if (staleWhileRevalidateMatches) {
            const secondsOfAllowedServingOfStaleWhileRevalidating = parseInt(staleWhileRevalidateMatches[1], 10);
            if (secondsOfAllowedServingOfStaleWhileRevalidating > 0) {
                // calculate time where we need to start revalidate
                cacheObject.secondsOfAllowedFreshCache = secondsOfAllowedCaching - ageInSeconds;
                resetTimeWhereRevalidationMustStart(cacheObject);
                // allow cache to live longer before being purged
                secondsBeforePurgingFromCache += secondsOfAllowedServingOfStaleWhileRevalidating;
                if (debugLogging) {
                    console.log(`Using stale-while-revalidate: ${secondsOfAllowedServingOfStaleWhileRevalidating} for ${url}`);
                }
            }
        }

        // check if we are allowed to serve stale response if the request fails
        const staleWhileErrorMatches = cacheControlHeader.match(/stale-while-error=(\d+)/);
        if (staleWhileErrorMatches) {
            const secondsOfServingStaleWhileError = parseInt(staleWhileErrorMatches[1], 10);
            if (secondsOfServingStaleWhileError > 0) {
                cacheObject.secondsOfServingStaleWhileError = secondsOfServingStaleWhileError - ageInSeconds;
                if (debugLogging) {
                    console.log(`Using stale-while-error: ${secondsOfServingStaleWhileError} for ${url}`);
                }
            }
        }
    }
    secondsBeforePurgingFromCache -= ageInSeconds;
    if (secondsBeforePurgingFromCache < 1) {
        if (debugLogging) {
            console.log(`The Age: ${ageInSeconds} for this response means that it is already expired and will not be cached for ${url}`);
        }
        return;
    }
    cacheObject.secondsBeforePurgingFromCache = secondsBeforePurgingFromCache;
    cache[cacheKey] = cacheObject;
    resetPurgeFromCache(cacheObject);
}

function clearPurge(cacheObject) {
    if (cacheObject.purgeFromCacheTimeoutID) {
        // reset any existing purge
        clearTimeout(cacheObject.purgeFromCacheTimeoutID);
    }
}

function resetPurgeFromCache(cacheObject) {
    clearPurge(cacheObject);
    cacheObject.purgeFromCacheTimeoutID = setTimeout(() => {
        delete cache[cacheObject.cacheKey]
    }, cacheObject.secondsBeforePurgingFromCache * 1000);
}

function resetPurgeFromCacheBecauseOfError(cacheObject) {
    clearPurge(cacheObject);
    cacheObject.purgeFromCacheTimeoutID = setTimeout(() => {
        delete cache[cacheObject.cacheKey]
    }, cacheObject.secondsOfServingStaleWhileError * 1000);
}

function startRevalidateResponseIfNeeded(cachedObject) {
    const timeRevalidationMustStart = cachedObject.timeRevalidationMustStart;
    if (!timeRevalidationMustStart) {
        return; // no time set for when to revalidate
    }
    const now = new Date();
    if (timeRevalidationMustStart > now) {
        return; // not time to revalidate yet
    }
    // Setting new timeRevalidationMustStart so other requests doesn't start new revalidations
    // not using lock, so in other languages there could be more threads revalidating, if they start the check at the same time.
    // But it does not look like there are any issues with this as node is single threaded https://blog.logrocket.com/node-js-multithreading-worker-threads-why-they-matter/
    const timeNextRevalidationCanStart = new Date();
    timeNextRevalidationCanStart.setUTCMilliseconds(timeNextRevalidationCanStart.getUTCMilliseconds() + secondsDelayBeforeNextRevalidationAttempt * 1000)
    cachedObject.timeRevalidationMustStart = timeNextRevalidationCanStart;
    // execute the revalidate later, but ASAP, not blocking this thread and hopefully not the request fetching
    setTimeout(async () => {
        await revalidate(cachedObject);
    }, msDelayForRevalidation);
}

async function revalidate(cachedObject) {
    let timeStarted;
    if (debugLogging) {
        timeStarted = new Date();
    }
    const fetchResponse = await nodeFetch(cachedObject.url, cachedObject.options_)
    if (fetchResponse.status === 304) {
        // not modified
        // reset eviction timer
        resetPurgeFromCache(cachedObject);
        // reset timeRevalidationMustStart
        resetTimeWhereRevalidationMustStart(cachedObject);
        // reset cache age
        cachedObject.cachedTime = new Date();
        if (debugLogging) {
            const msToRevalidate = new Date() - timeStarted;
            console.log(`Cache revalidated in ${msToRevalidate}ms, time reset for earliest next revalidation: ${cachedObject.timeRevalidationMustStart}, eviction in ${cachedObject.secondsBeforePurgingFromCache} seconds`);
        }
        return cachedObject.response;
    } else {
        if (fetchResponse.ok) {
            // not Not modified, it should indicate that the response has actually changed
            // set cache with ordinary means (reset eviction timer, sets new timeRevalidationMustStart)
            storeInCacheIfCacheable(fetchResponse, cachedObject.cacheKey, cachedObject.url, cachedObject.options_);
            return fetchResponse;
        } else {
            console.log(`Could not revalidate cache for ${cachedObject.url}, statusCode ${fetchResponse.status}, statusText ${fetchResponse.statusText}`);
            // check stale-while-error on the cached response
            if (!cachedObject.secondsOfServingStaleWhileError) {
                return fetchResponse; // stale-while-error not set, just return the failing response
            }
            // extend cache time to live by updating eviction timer
            resetPurgeFromCacheBecauseOfError(cachedObject);
            // increase timeNextRevalidationCanStart with a sane value, so we do not overburden the failing server
            const timeNextRevalidationCanStart = new Date();
            timeNextRevalidationCanStart.setUTCMilliseconds(timeNextRevalidationCanStart.getUTCMilliseconds() + secondsDelayBeforeNextRevalidationAttemptOnError * 1000)
            cachedObject.timeRevalidationMustStart = timeNextRevalidationCanStart;
            setAge(cachedObject);
            return cachedObject.response; // return the cached response
        }
    }
}

function getCacheKey(url, options_) {
    // keys can possibly get large, but hopefully most use cases will have smallish keys
    // this has the advantage of 0 cache key collisions
    return JSON.stringify({url, options_});
}

function setAge(cachedObject) {
    if (cachedObject.response.headers) { // cannot init headers, so Age can only be set if headers exist
        // set age. If the headers are passed to a CDNs, we can keep the correct freshness 
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Age
        const msAge = new Date() - cachedObject.cachedTime;
        const age = Math.round(msAge / 1000);
        cachedObject.response.headers.set("Age", age);
    }
}

export default async function fetch(url, options_) {
    // check cache
    const cacheKey = getCacheKey(url, options_);
    const cachedObject = cache[cacheKey];
    if (cachedObject) {
        if (cachedObject.mustRevalidateWhenExpired && cachedObject.timeRevalidationMustStart < new Date()) {
            // We must call the server to validate the cache before usage
            // A 304 Not Modified is usually faster than getting the entire response again
            // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/304
            return revalidate(cachedObject);
        }
        // check if there is need for background revalidation
        startRevalidateResponseIfNeeded(cachedObject);
        setAge(cachedObject);
        return cachedObject.response;
    }
    // do request
    const fetchResponse = await nodeFetch(url, options_);
    // store response in cache if applicable
    storeInCacheIfCacheable(fetchResponse, cacheKey, url, options_);

    return fetchResponse;
}