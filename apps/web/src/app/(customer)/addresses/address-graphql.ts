import { graphql } from "@/graphql/generated";

// Shared GraphQL documents for the saved-address book. Kept in one place so the
// management page (addresses/) and the checkout AddressSelector call the same
// documents (mirrors how neighboring pages colocate their queries/mutations).

export const MyAddressesQuery = graphql(`
  query MyAddresses {
    myAddresses {
      id
      label
      text
      lat
      lng
      phone
      notes
      isDefault
      createdAt
    }
  }
`);

export const SaveAddressMutation = graphql(`
  mutation SaveAddress($input: SaveAddressInput!) {
    saveAddress(input: $input) {
      id
      label
      text
      lat
      lng
      phone
      notes
      isDefault
    }
  }
`);

export const UpdateAddressMutation = graphql(`
  mutation UpdateAddress($id: String!, $input: UpdateAddressInput!) {
    updateAddress(id: $id, input: $input) {
      id
      label
      text
      lat
      lng
      phone
      notes
      isDefault
    }
  }
`);

export const DeleteAddressMutation = graphql(`
  mutation DeleteAddress($id: String!) {
    deleteAddress(id: $id)
  }
`);
