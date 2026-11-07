// One pattern for the /scan email gate: the form, the audit route that opens the 3rd finding and
// the radar-alert route must agree, or the page promises an unlock the server refuses.
export const LEAD_EMAIL_RE = /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,190}\.[a-zA-Z]{2,24}$/;
