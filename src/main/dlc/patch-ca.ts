// Configure TLS to trust both custom CA and system CAs
// This allows seamless migration from self-signed to Let's Encrypt certificates
import tls from 'tls';
const caCert = `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIURYkFeoCaUATIyHvLk87H4V9PMy4wDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNjAxMDMwOTA5NDRaFw0zNjAx
MDEwOTA5NDRaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCyjrVN3Y0zw3l7bGb3IBKnYfElzwVpDAEmdv+ITdte
2ehTZC5Yp6kLgtcZ+wf8la0SjAq27cRlQFhC1cfW0vigZhkVQW/onMKDelXIAVJJ
YFGj8GPuumDf7KcSoEPHlCgc5GT1gpM3g1MtfSfhMGkS1MtXpEBNzoswbUf9LqU2
tBWnE4B9Syag4sjhn2fNNElHJVmR9dsZINDPMIAddrgrm2PYw4XkKrHrQ1kbZEA1
PIFD6QR42hMFaQ4OqNlZ3QpjLrLp4ZCaMJC0QU9UJXUYfWy0LAnDqIh+mko3zdu7
zzVM9zFbuMfK9vxOSPntGeJZYoVT/Wq8fvlzGB+Q4ZFbrWgrRCO46d4F8fAqHOoc
zBOX2tWQUAOjsr194MkNExxyGvH2VloR5fpUn6g335nPO1OQFAiTiYOPus0XUlBb
h1Pix7pJ7s4TMHANPNuwrFscpywbrZFWFWwY1PrDQMIydjWjCRdFbyP+WZOZl+Dv
u7s9R60AtYDbjrmC+68eQCHPvfyNCjil+FsLlos1GhHY0qN4Af4OXBUGGYGIPF0Z
0JKSWIZubjWea2VPsbP8fFiv31k5W0DzfR4lLvktfVsKqJOy1EVeW0Kkuux6IAT0
+r/vYkehizXI11xZsaEDPjpV3Ew0ioJ6wSL3W++EKGHUF4UdbvMZqB1WMHzvTccc
BwIDAQABo1MwUTAdBgNVHQ4EFgQUqwPzo8dzooyw7Jb6MKA2ra9zzjowHwYDVR0j
BBgwFoAUqwPzo8dzooyw7Jb6MKA2ra9zzjowDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAgEAOuYBDgBqmKllrgHGvZW/eWue8DVtJESBCF/6hBEZEXzK
PtVDkZ8+Qjg/BN/ON/PozT5E4LCs65iPSxmWhSnrgCalySGaNiUeynuDg7nKDU7J
BAQpiRXXSOXxnd1HOY/hxBhMBezVA4ptuHfmLaHhF/IyO5BryG1vuy2ltmjFOYhv
w8+uFhrSvYVrwFJHglOXcSk2hlDzf0o9bAPIRsyniypDjbRx1EGtJIPPNS1gjmT2
0T+E6XGrcdXzaRqWyAbhwX0GEz6UeJ0OxbVQUYjwyEeXeDGytYkOIdT6eEpdp9mN
Tu9ongfAW8B+v4LLf47MoxWe1yrdV57Ye1W5IfyEu8RUxTl7B64Pn+DzRqjYn8gY
E2ZN7BMNhkPjp27yE2Svjhhi56p9JF8usrI7HRLQG38VoSQk8PCA7UIlEoeXBIs4
NyDEnchq1N0jZZ+Xr7bBrXkzTeaZcc35gBuSuBCjlIS/PVpf4XGOT0zDOIG/qoT1
QPubztTfblRYCUzeqom4NJx9FlhXX6+Vc3hIJpgp3Knkbc86BUVVJ6Ki3VpS9cl2
M6ZBAVQ9/Q3j2tBhiyLcniM9CQqXBL+Fq9NirLszbuBBg57Zmt7pWfS1XhlmGTIg
Bl4qEBuWCWtpIXBE3rQ/UoRd3b7Py0ndpaFQ9LCdu8+rlawM5XzAZcq5SddaNK0=
-----END CERTIFICATE-----
`;

export default function patchCA() {
  // Monkey-patch tls.connect to add both custom CA and system CAs
  const originalTlsConnect = tls.connect;
  tls.connect = function (options, callback) {
    if (typeof options === 'number') {
      options = { port: options };
    } else if (typeof options === 'string') {
      options = { path: options };
    }

    // Add both custom CA and system CAs to trust list
    if (!options.ca) {
      options.ca = [caCert, ...tls.rootCertificates];
    } else if (Array.isArray(options.ca)) {
      options.ca.push(caCert);
      options.ca.push(...tls.rootCertificates);
    } else {
      options.ca = [options.ca, caCert, ...tls.rootCertificates];
    }

    return originalTlsConnect.call(this, options, callback);
  };
}
