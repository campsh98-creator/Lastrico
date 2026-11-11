/**
 * Phase 4.34: how Lastrico identifies itself to the free services it calls (FOSSGIS Valhalla,
 * OSRM, Nominatim, Photon). Their usage policies ask for an application name and a way to reach
 * the maintainer; the stock User-Agent of an HTTP library is not accepted by Nominatim.
 *
 * The contact is the public project repository, which the maintainer controls and where issues can
 * be opened. Earlier builds named a beta site that no longer answers (HTTP 401). No personal
 * e-mail address is sent.
 */
export const PROJECT_CONTACT_URL = "https://github.com/campsh98-creator/Lastrico";
export const PROJECT_VERSION = "0.5.0";
export const PROVIDER_USER_AGENT = `Lastrico/${PROJECT_VERSION} (+${PROJECT_CONTACT_URL})`;
