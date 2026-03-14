const React = require('react');

const DragList = React.forwardRef((props, ref) => {
  return React.createElement('DragList', { ...props, ref }, props.children);
});

module.exports = {
  __esModule: true,
  default: DragList,
};
