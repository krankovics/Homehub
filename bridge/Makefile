.PHONY: build build-armv7 build-amd64
build: build-amd64 build-armv7
build-amd64:
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/homehub-bridge-linux-amd64 ./cmd/homehub-bridge
build-armv7:
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -o bin/homehub-bridge-linux-armv7 ./cmd/homehub-bridge
