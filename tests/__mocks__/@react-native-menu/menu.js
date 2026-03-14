const React = require('react');

const MenuView = React.forwardRef((props, ref) => {
  return React.createElement('MenuView', { ...props, ref }, props.children);
});

module.exports = {
  MenuView,
};
