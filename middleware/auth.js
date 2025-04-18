export const authenticate = (req, res, next) => {
  // Temporary mock user for testing (replace with real auth later)
  req.user = { id: 'test-user' };
  next();
};
