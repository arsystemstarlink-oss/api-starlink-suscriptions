export const schedulerService = {
  initialize: async () => {},
  shutdown: () => {},
  getStatus: () => ({ isRunning: false, config: null }),
  updateConfig: async (data: any) => data,
  getConfig: async () => null
};
