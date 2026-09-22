export class CameraRequestTimeoutError extends Error {
  override name = 'CameraRequestTimeoutError'
}

export function requestCameraStream(
  devices: Pick<MediaDevices, 'getUserMedia'>,
  constraints: MediaStreamConstraints,
  timeoutMs = 15_000,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(
      () => {
        settled = true
        reject(new CameraRequestTimeoutError('Camera request timed out'))
      },
      timeoutMs,
    )
    devices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve(stream)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
