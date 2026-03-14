const React = require('react');

const TrueSheet = React.forwardRef((props, ref) => {
  return React.createElement('TrueSheet', { ...props, ref }, props.children);
});

module.exports = {
  __esModule: true,
  default: TrueSheet,
  TrueSheet,
};
