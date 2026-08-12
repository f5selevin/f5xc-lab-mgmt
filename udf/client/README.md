# UDF deployment heartbeat client

Build the image:

```shell udf/client/README.md
cd udf/client
docker build -t f5xc-udf-deployment-client .
```

Run it on the UDF VM with host networking. Host networking is required because the metadata service listens on `localhost:5123`:

```shell udf/client/README.md
docker run -d \
  --name f5xc-udf-deployment-client \
  --restart unless-stopped \
  --network host \
  -e API_URL=https://your-lab-management-site.example \
  f5xc-udf-deployment-client
```

Optional environment variables:

- `PING_INTERVAL_MS`: heartbeat interval; defaults to `60000`.
- `METADATA_URL`: local metadata endpoint; defaults to `http://localhost:5123/metadata`.

The client retries unavailable or incomplete local metadata 10 times with 10 seconds between attempts. It sends `deploymentId`, `email`, and `namespace` to `POST /deployment/ping`. The server validates the caller against the UDF hostname already stored with that deployment.
