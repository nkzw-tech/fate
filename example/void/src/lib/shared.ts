export type SharedData = {
  auth: {
    user: {
      email: string;
      id: string;
      name: string;
    } | null;
  };
  origin: string;
};
