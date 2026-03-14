module.exports = {
  addScreenshotListener: jest.fn(() => ({ remove: jest.fn() })),
  removeScreenshotListener: jest.fn(),
  enableSecureView: jest.fn(),
  disableSecureView: jest.fn(),
  isCaptured: jest.fn().mockResolvedValue(false),
  preventScreenCapture: jest.fn(),
  allowScreenCapture: jest.fn(),
};
