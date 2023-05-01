module.exports = function (config) {
  // nothing; pure defaults

  config.extra_index = [{
    name: 'itch',
    defines: {
      ...config.default_defines,
      PLATFORM: 'web',
    },
    zip: true,
  }];
};
