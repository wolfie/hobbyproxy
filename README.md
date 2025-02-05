# Hobbyproxy

Hobbyproxy is a reverse proxy server that manages certificates through [Let's Encrypt](https://letsencrypt.org/), hooks to [Cloudflare](https://www.cloudflare.com/) to manage individual DNS entries (and keeps it synced with your dynamic IP). Hobbyproxy is optimized to work in a hobby setting against locally hosted virtual servers, and people like me who doesn't like managing cloud infrastructure.

## Startup

1. Clone the repository locally from GitHub
1. Run `nvm install` to use the supported Node version
1. Run `pnpm install` to install all required Node dependencies
1. Run `pnpm start` to start the server.
   - You will be prompted to answer some questions, and you need to restart the server a few times after configurations.
   - After initial configuration, restarting the service does not require any user input.

For obvious reasons, you should make sure that your server has a static IP in your local network, and make sure that external 80/443 traffic is routed to this server's ports 8080/8443, respectively.

## Admin endpoints

You can access the configurations of the server with the LAN IP. Any other address or public IP is treated as external access, and cannot configure anything.

- `GET /` to get basic status of the server in JSON format
- `POST /` with a JSON body of format `{"hostname": "yourservice.yourdomain.com", "target": "http://192.168.1.1"}`.
  - If `target` is omitted, the target will be `http://ip` where `ip` is the IP of the sender machine.
  - The target service should frequently (e.g. daily or hourly) re-send the `POST` request to Hobbyproxy to keep the IP up-to-date and as a signal that the service is still alive.

## Features

Hobbyproxy is trying to clean up unused routes - certificates are renewed for as long as the route is being visited and the target service keeps sending `POST` requests as a keepalive mechanism. Once a route is detected as stale:

- The route is removed from the reverse proxy
- The certificate file is deleted
- The DNS entry is removed

## Caveats

- Only Cloudflare is supported as a DNS host.
- Hobbyproxy will only create separate DNS entries - wildcard domains are not supported. This is by design.
- Only one Cloudflare DNS zone is supported for now. (If you have multiple zones, but restrict your API key to one zone, it should still work)
- Hobbyproxy does its best to clean up after any abandoned routes, but there are situations where DNS entries can be left hanging.
