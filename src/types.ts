export interface Item {
    uid: string,
    locale: string,
    version: string,
    type: string
}

export interface Headers {
    api_key: string,
    authtoken: string,
    "Content-Type": string,
}