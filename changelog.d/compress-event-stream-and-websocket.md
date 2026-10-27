### Changed
- The roster event stream is gzipped for a browser that accepts it, and the terminal WebSocket
  deflates frames of 128 bytes or more, so an open page uses a fraction of the bandwidth. A client
  that does not take either still gets the plain stream and plain frames.
