/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from "react";
import { fireEvent, render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mocked } from "jest-mock";
import { Room, User, MatrixClient, RoomMember, MatrixEvent, EventType } from "matrix-js-sdk/src/matrix";
import { Phase, VerificationRequest } from "matrix-js-sdk/src/crypto/verification/request/VerificationRequest";
import { DeviceTrustLevel, UserTrustLevel } from "matrix-js-sdk/src/crypto/CrossSigning";
import { DeviceInfo } from "matrix-js-sdk/src/crypto/deviceinfo";
import { defer } from "matrix-js-sdk/src/utils";

import UserInfo, {
    BanToggleButton,
    DeviceItem,
    disambiguateDevices,
    getPowerLevels,
    isMuted,
    PowerLevelEditor,
    RoomAdminToolsContainer,
    RoomKickButton,
    UserInfoHeader,
    UserOptionsSection,
} from "../../../../src/components/views/right_panel/UserInfo";
import dis from "../../../../src/dispatcher/dispatcher";
import { RightPanelPhases } from "../../../../src/stores/right-panel/RightPanelStorePhases";
import { MatrixClientPeg } from "../../../../src/MatrixClientPeg";
import MatrixClientContext from "../../../../src/contexts/MatrixClientContext";
import MultiInviter from "../../../../src/utils/MultiInviter";
import * as mockVerification from "../../../../src/verification";
import Modal from "../../../../src/Modal";
import { E2EStatus } from "../../../../src/utils/ShieldUtils";
import { DirectoryMember, startDmOnFirstMessage } from "../../../../src/utils/direct-messages";
import { flushPromises } from "../../../test-utils";

jest.mock("../../../../src/utils/direct-messages", () => ({
    ...jest.requireActual("../../../../src/utils/direct-messages"),
    startDmOnFirstMessage: jest.fn(),
}));

jest.mock("../../../../src/dispatcher/dispatcher");

jest.mock("../../../../src/customisations/UserIdentifier", () => {
    return {
        getDisplayUserIdentifier: jest.fn().mockReturnValue("customUserIdentifier"),
    };
});

jest.mock("../../../../src/utils/DMRoomMap", () => {
    const mock = {
        getUserIdForRoomId: jest.fn(),
        getDMRoomsForUserId: jest.fn(),
    };

    return {
        shared: jest.fn().mockReturnValue(mock),
        sharedInstance: mock,
    };
});

const mockRoom = mocked({
    roomId: "!fkfk",
    getType: jest.fn().mockReturnValue(undefined),
    isSpaceRoom: jest.fn().mockReturnValue(false),
    getMember: jest.fn().mockReturnValue(undefined),
    getMxcAvatarUrl: jest.fn().mockReturnValue("mock-avatar-url"),
    name: "test room",
    on: jest.fn(),
    off: jest.fn(),
    currentState: {
        getStateEvents: jest.fn(),
        on: jest.fn(),
    },
    getEventReadUpTo: jest.fn(),
} as unknown as Room);

const mockSpace = mocked({
    roomId: "!fkfk",
    getType: jest.fn().mockReturnValue("m.space"),
    isSpaceRoom: jest.fn().mockReturnValue(true),
    getMember: jest.fn().mockReturnValue(undefined),
    getMxcAvatarUrl: jest.fn().mockReturnValue("mock-avatar-url"),
    name: "test room",
    on: jest.fn(),
    off: jest.fn(),
    currentState: {
        getStateEvents: jest.fn(),
        on: jest.fn(),
    },
    getEventReadUpTo: jest.fn(),
} as unknown as Room);

const mockClient = mocked({
    getUser: jest.fn(),
    isGuest: jest.fn().mockReturnValue(false),
    isUserIgnored: jest.fn(),
    getIgnoredUsers: jest.fn(),
    setIgnoredUsers: jest.fn(),
    isCryptoEnabled: jest.fn(),
    getUserId: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    isSynapseAdministrator: jest.fn().mockResolvedValue(false),
    isRoomEncrypted: jest.fn().mockReturnValue(false),
    doesServerSupportUnstableFeature: jest.fn().mockReturnValue(false),
    mxcUrlToHttp: jest.fn().mockReturnValue("mock-mxcUrlToHttp"),
    removeListener: jest.fn(),
    currentState: {
        on: jest.fn(),
    },
    checkDeviceTrust: jest.fn(),
    checkUserTrust: jest.fn(),
    getRoom: jest.fn(),
    credentials: {},
    setPowerLevel: jest.fn(),
} as unknown as MatrixClient);

const defaultUserId = "@user:example.com";
const defaultUser = new User(defaultUserId);

beforeEach(() => {
    jest.spyOn(MatrixClientPeg, "get").mockReturnValue(mockClient);
});

afterEach(() => {
    mockClient.getUser.mockClear().mockReturnValue({} as unknown as User);
});

describe("<UserInfo />", () => {
    const verificationRequest = {
        pending: true,
        on: jest.fn(),
        phase: Phase.Ready,
        channel: { transactionId: 1 },
        otherPartySupportsMethod: jest.fn(),
        off: jest.fn(),
    } as unknown as VerificationRequest;

    const defaultProps = {
        user: defaultUser,
        // idk what is wrong with this type
        phase: RightPanelPhases.RoomMemberInfo as RightPanelPhases.RoomMemberInfo,
        onClose: jest.fn(),
    };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<UserInfo {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    it("closes on close button click", async () => {
        renderComponent();

        await userEvent.click(screen.getByTestId("base-card-close-button"));

        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    describe("without a room", () => {
        it("does not render space header", () => {
            renderComponent();
            expect(screen.queryByTestId("space-header")).not.toBeInTheDocument();
        });

        it("renders user info", () => {
            renderComponent();
            expect(screen.getByRole("heading", { name: defaultUserId })).toBeInTheDocument();
        });

        it("renders encryption info panel without pending verification", () => {
            renderComponent({ phase: RightPanelPhases.EncryptionPanel });
            expect(screen.getByRole("heading", { name: /encryption/i })).toBeInTheDocument();
        });

        it("renders encryption verification panel with pending verification", () => {
            renderComponent({ phase: RightPanelPhases.EncryptionPanel, verificationRequest });

            expect(screen.queryByRole("heading", { name: /encryption/i })).not.toBeInTheDocument();
            // the verificationRequest has phase of Phase.Ready but .otherPartySupportsMethod
            // will not return true, so we expect to see the noCommonMethod error from VerificationPanel
            expect(screen.getByText(/try with a different client/i)).toBeInTheDocument();
        });

        it("renders close button correctly when encryption panel with a pending verification request", () => {
            renderComponent({ phase: RightPanelPhases.EncryptionPanel, verificationRequest });
            expect(screen.getByTestId("base-card-close-button")).toHaveAttribute("title", "Cancel");
        });
    });

    describe("with a room", () => {
        it("renders user info", () => {
            renderComponent({ room: mockRoom });
            expect(screen.getByRole("heading", { name: defaultUserId })).toBeInTheDocument();
        });

        it("does not render space header when room is not a space room", () => {
            renderComponent({ room: mockRoom });
            expect(screen.queryByTestId("space-header")).not.toBeInTheDocument();
        });

        it("renders space header when room is a space room", () => {
            const spaceRoom = {
                ...mockRoom,
                isSpaceRoom: jest.fn().mockReturnValue(true),
            };
            renderComponent({ room: spaceRoom });
            expect(screen.getByTestId("space-header")).toBeInTheDocument();
        });

        it("renders encryption info panel without pending verification", () => {
            renderComponent({ phase: RightPanelPhases.EncryptionPanel, room: mockRoom });
            expect(screen.getByRole("heading", { name: /encryption/i })).toBeInTheDocument();
        });

        it("renders encryption verification panel with pending verification", () => {
            renderComponent({ phase: RightPanelPhases.EncryptionPanel, verificationRequest, room: mockRoom });

            expect(screen.queryByRole("heading", { name: /encryption/i })).not.toBeInTheDocument();
            // the verificationRequest has phase of Phase.Ready but .otherPartySupportsMethod
            // will not return true, so we expect to see the noCommonMethod error from VerificationPanel
            expect(screen.getByText(/try with a different client/i)).toBeInTheDocument();
        });
    });
});

describe("<UserInfoHeader />", () => {
    const defaultMember = new RoomMember(mockRoom.roomId, defaultUserId);

    const defaultProps = {
        member: defaultMember,
        roomId: mockRoom.roomId,
    };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<UserInfoHeader {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    it("does not render an e2e icon in the header if e2eStatus prop is undefined", () => {
        renderComponent();
        const header = screen.getByRole("heading", { name: defaultUserId });

        expect(header.getElementsByClassName("mx_E2EIcon")).toHaveLength(0);
    });

    it("renders an e2e icon in the header if e2eStatus prop is defined", () => {
        renderComponent({ e2eStatus: E2EStatus.Normal });
        const header = screen.getByRole("heading", { name: defaultUserId });

        expect(header.getElementsByClassName("mx_E2EIcon")).toHaveLength(1);
    });

    it("renders custom user identifiers in the header", () => {
        renderComponent();

        expect(screen.getByText("customUserIdentifier")).toBeInTheDocument();
    });
});

describe("<DeviceItem />", () => {
    const device = { deviceId: "deviceId", getDisplayName: () => "deviceName" } as DeviceInfo;
    const defaultProps = {
        userId: defaultUserId,
        device,
    };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<DeviceItem {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    const setMockUserTrust = (isVerified = false) => {
        mockClient.checkUserTrust.mockReturnValue({ isVerified: () => isVerified } as UserTrustLevel);
    };
    const setMockDeviceTrust = (isVerified = false, isCrossSigningVerified = false) => {
        mockClient.checkDeviceTrust.mockReturnValue({
            isVerified: () => isVerified,
            isCrossSigningVerified: () => isCrossSigningVerified,
        } as DeviceTrustLevel);
    };

    const mockVerifyDevice = jest.spyOn(mockVerification, "verifyDevice");

    beforeEach(() => {
        setMockUserTrust();
        setMockDeviceTrust();
    });

    afterEach(() => {
        mockClient.checkDeviceTrust.mockReset();
        mockClient.checkUserTrust.mockReset();
        mockVerifyDevice.mockClear();
    });

    afterAll(() => {
        mockVerifyDevice.mockRestore();
    });

    it("with unverified user and device, displays button without a label", () => {
        renderComponent();

        expect(screen.getByRole("button", { name: device.getDisplayName()! })).toBeInTheDocument;
        expect(screen.queryByText(/trusted/i)).not.toBeInTheDocument();
    });

    it("with verified user only, displays button with a 'Not trusted' label", () => {
        setMockUserTrust(true);
        renderComponent();

        expect(screen.getByRole("button", { name: `${device.getDisplayName()} Not trusted` })).toBeInTheDocument;
    });

    it("with verified device only, displays no button without a label", () => {
        setMockDeviceTrust(true);
        renderComponent();

        expect(screen.getByText(device.getDisplayName()!)).toBeInTheDocument();
        expect(screen.queryByText(/trusted/)).not.toBeInTheDocument();
    });

    it("when userId is the same as userId from client, uses isCrossSigningVerified to determine if button is shown", () => {
        mockClient.getUserId.mockReturnValueOnce(defaultUserId);
        renderComponent();

        // set trust to be false for isVerified, true for isCrossSigningVerified
        setMockDeviceTrust(false, true);

        // expect to see no button in this case
        expect(screen.queryByRole("button")).not.toBeInTheDocument;
        expect(screen.getByText(device.getDisplayName()!)).toBeInTheDocument();
    });

    it("with verified user and device, displays no button and a 'Trusted' label", () => {
        setMockUserTrust(true);
        setMockDeviceTrust(true);
        renderComponent();

        expect(screen.queryByRole("button")).not.toBeInTheDocument;
        expect(screen.getByText(device.getDisplayName()!)).toBeInTheDocument();
        expect(screen.getByText("Trusted")).toBeInTheDocument();
    });

    it("does not call verifyDevice if client.getUser returns null", async () => {
        mockClient.getUser.mockReturnValueOnce(null);
        renderComponent();

        const button = screen.getByRole("button", { name: device.getDisplayName()! });
        expect(button).toBeInTheDocument;
        await userEvent.click(button);

        expect(mockVerifyDevice).not.toHaveBeenCalled();
    });

    it("calls verifyDevice if client.getUser returns an object", async () => {
        mockClient.getUser.mockReturnValueOnce(defaultUser);
        // set mock return of isGuest to short circuit verifyDevice call to avoid
        // even more mocking
        mockClient.isGuest.mockReturnValueOnce(true);
        renderComponent();

        const button = screen.getByRole("button", { name: device.getDisplayName()! });
        expect(button).toBeInTheDocument;
        await userEvent.click(button);

        expect(mockVerifyDevice).toHaveBeenCalledTimes(1);
        expect(mockVerifyDevice).toHaveBeenCalledWith(defaultUser, device);
    });
});

describe("<UserOptionsSection />", () => {
    const member = new RoomMember(mockRoom.roomId, defaultUserId);
    const defaultProps = { member, isIgnored: false, canInvite: false, isSpace: false };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<UserOptionsSection {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    const inviteSpy = jest.spyOn(MultiInviter.prototype, "invite");

    beforeEach(() => {
        inviteSpy.mockReset();
        mockClient.setIgnoredUsers.mockClear();
    });

    afterEach(() => Modal.closeCurrentModal("End of test"));

    afterAll(() => {
        inviteSpy.mockRestore();
    });

    it("always shows share user button", () => {
        renderComponent();
        expect(screen.getByRole("button", { name: /share link to user/i })).toBeInTheDocument();
    });

    it("does not show ignore or direct message buttons when member userId matches client userId", () => {
        mockClient.getUserId.mockReturnValueOnce(member.userId);
        renderComponent();

        expect(screen.queryByRole("button", { name: /ignore/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /message/i })).not.toBeInTheDocument();
    });

    it("shows ignore, direct message and mention buttons when member userId does not match client userId", () => {
        // call to client.getUserId returns undefined, which will not match member.userId
        renderComponent();

        expect(screen.getByRole("button", { name: /ignore/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /message/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /mention/i })).toBeInTheDocument();
    });

    it("when call to client.getRoom is null, does not show read receipt button", () => {
        mockClient.getRoom.mockReturnValueOnce(null);
        renderComponent();

        expect(screen.queryByRole("button", { name: /jump to read receipt/i })).not.toBeInTheDocument();
    });

    it("when call to client.getRoom is non-null and room.getEventReadUpTo is null, does not show read receipt button", () => {
        mockRoom.getEventReadUpTo.mockReturnValueOnce(null);
        mockClient.getRoom.mockReturnValueOnce(mockRoom);
        renderComponent();

        expect(screen.queryByRole("button", { name: /jump to read receipt/i })).not.toBeInTheDocument();
    });

    it("when calls to client.getRoom and room.getEventReadUpTo are non-null, shows read receipt button", () => {
        mockRoom.getEventReadUpTo.mockReturnValueOnce("1234");
        mockClient.getRoom.mockReturnValueOnce(mockRoom);
        renderComponent();

        expect(screen.getByRole("button", { name: /jump to read receipt/i })).toBeInTheDocument();
    });

    it("clicking the read receipt button calls dispatch with correct event_id", async () => {
        const mockEventId = "1234";
        mockRoom.getEventReadUpTo.mockReturnValue(mockEventId);
        mockClient.getRoom.mockReturnValue(mockRoom);
        renderComponent();

        const readReceiptButton = screen.getByRole("button", { name: /jump to read receipt/i });

        expect(readReceiptButton).toBeInTheDocument();
        await userEvent.click(readReceiptButton);
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: "view_room",
            event_id: mockEventId,
            highlighted: true,
            metricsTrigger: undefined,
            room_id: "!fkfk",
        });

        mockRoom.getEventReadUpTo.mockReset();
        mockClient.getRoom.mockReset();
    });

    it("firing the read receipt event handler with a null event_id calls dispatch with undefined not null", async () => {
        const mockEventId = "1234";
        // the first call is the check to see if we should render the button, second call is
        // when the button is clicked
        mockRoom.getEventReadUpTo.mockReturnValueOnce(mockEventId).mockReturnValueOnce(null);
        mockClient.getRoom.mockReturnValue(mockRoom);
        renderComponent();

        const readReceiptButton = screen.getByRole("button", { name: /jump to read receipt/i });

        expect(readReceiptButton).toBeInTheDocument();
        await userEvent.click(readReceiptButton);
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: "view_room",
            event_id: undefined,
            highlighted: true,
            metricsTrigger: undefined,
            room_id: "!fkfk",
        });

        mockClient.getRoom.mockReset();
    });

    it("does not show the invite button when canInvite is false", () => {
        renderComponent();
        expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
    });

    it("shows the invite button when canInvite is true", () => {
        renderComponent({ canInvite: true });
        expect(screen.getByRole("button", { name: /invite/i })).toBeInTheDocument();
    });

    it("clicking the invite button will call MultiInviter.invite", async () => {
        // to save mocking, we will reject the call to .invite
        const mockErrorMessage = new Error("test error message");
        inviteSpy.mockRejectedValue(mockErrorMessage);

        // render the component and click the button
        renderComponent({ canInvite: true });
        const inviteButton = screen.getByRole("button", { name: /invite/i });
        expect(inviteButton).toBeInTheDocument();
        await userEvent.click(inviteButton);

        // check that we have called .invite
        expect(inviteSpy).toHaveBeenCalledWith([member.userId]);

        // check that the test error message is displayed
        await waitFor(() => {
            expect(screen.getByText(mockErrorMessage.message)).toBeInTheDocument();
        });
    });

    it("if calling .invite throws something strange, show default error message", async () => {
        inviteSpy.mockRejectedValue({ this: "could be anything" });

        // render the component and click the button
        renderComponent({ canInvite: true });
        const inviteButton = screen.getByRole("button", { name: /invite/i });
        expect(inviteButton).toBeInTheDocument();
        await userEvent.click(inviteButton);

        // check that the default test error message is displayed
        await waitFor(() => {
            expect(screen.getByText(/operation failed/i)).toBeInTheDocument();
        });
    });

    it("shows a modal before ignoring the user", async () => {
        const originalCreateDialog = Modal.createDialog;
        const modalSpy = (Modal.createDialog = jest.fn().mockReturnValue({
            finished: Promise.resolve([true]),
            close: () => {},
        }));

        try {
            mockClient.getIgnoredUsers.mockReturnValue([]);
            renderComponent({ isIgnored: false });

            await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
            expect(modalSpy).toHaveBeenCalled();
            expect(mockClient.setIgnoredUsers).toHaveBeenLastCalledWith([member.userId]);
        } finally {
            Modal.createDialog = originalCreateDialog;
        }
    });

    it("cancels ignoring the user", async () => {
        const originalCreateDialog = Modal.createDialog;
        const modalSpy = (Modal.createDialog = jest.fn().mockReturnValue({
            finished: Promise.resolve([false]),
            close: () => {},
        }));

        try {
            mockClient.getIgnoredUsers.mockReturnValue([]);
            renderComponent({ isIgnored: false });

            await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
            expect(modalSpy).toHaveBeenCalled();
            expect(mockClient.setIgnoredUsers).not.toHaveBeenCalled();
        } finally {
            Modal.createDialog = originalCreateDialog;
        }
    });

    it("unignores the user", async () => {
        mockClient.getIgnoredUsers.mockReturnValue([member.userId]);
        renderComponent({ isIgnored: true });

        await userEvent.click(screen.getByRole("button", { name: "Unignore" }));
        expect(mockClient.setIgnoredUsers).toHaveBeenCalledWith([]);
    });

    it.each([
        ["for a RoomMember", member, member.getMxcAvatarUrl()],
        ["for a User", defaultUser, defaultUser.avatarUrl],
    ])(
        "clicking »message« %s should start a DM",
        async (test: string, member: RoomMember | User, expectedAvatarUrl: string | undefined) => {
            const deferred = defer<string>();
            mocked(startDmOnFirstMessage).mockReturnValue(deferred.promise);

            renderComponent({ member });
            await userEvent.click(screen.getByText("Message"));

            // Checking the attribute, because the button is a DIV and toBeDisabled() does not work.
            expect(screen.getByText("Message")).toHaveAttribute("disabled");

            expect(startDmOnFirstMessage).toHaveBeenCalledWith(mockClient, [
                new DirectoryMember({
                    user_id: member.userId,
                    display_name: member.rawDisplayName,
                    avatar_url: expectedAvatarUrl,
                }),
            ]);

            await act(async () => {
                deferred.resolve("!dm:example.com");
                await flushPromises();
            });

            // Checking the attribute, because the button is a DIV and toBeDisabled() does not work.
            expect(screen.getByText("Message")).not.toHaveAttribute("disabled");
        },
    );
});

describe("<PowerLevelEditor />", () => {
    const defaultMember = new RoomMember(mockRoom.roomId, defaultUserId);

    const defaultProps = {
        user: defaultMember,
        room: mockRoom,
        roomPermissions: {
            modifyLevelMax: 100,
            canEdit: false,
            canInvite: false,
        },
    };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<PowerLevelEditor {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    it("renders a power level combobox", () => {
        renderComponent();

        expect(screen.getByRole("combobox", { name: "Power level" })).toBeInTheDocument();
    });

    it("renders a combobox and attempts to change power level on change of the combobox", async () => {
        const startPowerLevel = 999;
        const powerLevelEvent = new MatrixEvent({
            type: EventType.RoomPowerLevels,
            content: { users: { [defaultUserId]: startPowerLevel }, users_default: 1 },
        });
        mockRoom.currentState.getStateEvents.mockReturnValue(powerLevelEvent);
        mockClient.getUserId.mockReturnValueOnce(defaultUserId);
        mockClient.setPowerLevel.mockResolvedValueOnce({ event_id: "123" });
        renderComponent();

        const changedPowerLevel = 100;

        fireEvent.change(screen.getByRole("combobox", { name: "Power level" }), {
            target: { value: changedPowerLevel },
        });

        await screen.findByText("Demote", { exact: true });

        // firing the event will raise a dialog warning about self demotion, wait for this to appear then click on it
        await userEvent.click(await screen.findByText("Demote", { exact: true }));
        expect(mockClient.setPowerLevel).toHaveBeenCalledTimes(1);
        expect(mockClient.setPowerLevel).toHaveBeenCalledWith(
            mockRoom.roomId,
            defaultMember.userId,
            changedPowerLevel,
            powerLevelEvent,
        );
    });
});

describe("<RoomKickButton />", () => {
    const defaultMember = new RoomMember(mockRoom.roomId, defaultUserId);
    const memberWithInviteMembership = { ...defaultMember, membership: "invite" };
    const memberWithJoinMembership = { ...defaultMember, membership: "join" };

    const defaultProps = { room: mockRoom, member: defaultMember, startUpdating: jest.fn(), stopUpdating: jest.fn() };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<RoomKickButton {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    const createDialogSpy: jest.SpyInstance = jest.spyOn(Modal, "createDialog");

    afterEach(() => {
        createDialogSpy.mockReset();
    });

    it("renders nothing if member.membership is undefined", () => {
        // .membership is undefined in our member by default
        const { container } = renderComponent();
        expect(container).toBeEmptyDOMElement();
    });

    it("renders something if member.membership is 'invite' or 'join'", () => {
        let result = renderComponent({ member: memberWithInviteMembership });
        expect(result.container).not.toBeEmptyDOMElement();

        cleanup();

        result = renderComponent({ member: memberWithJoinMembership });
        expect(result.container).not.toBeEmptyDOMElement();
    });

    it("renders the correct label", () => {
        // test for room
        renderComponent({ member: memberWithJoinMembership });
        expect(screen.getByText(/remove from room/i)).toBeInTheDocument();
        cleanup();

        renderComponent({ member: memberWithInviteMembership });
        expect(screen.getByText(/disinvite from room/i)).toBeInTheDocument();
        cleanup();

        // test for space
        mockRoom.isSpaceRoom.mockReturnValue(true);
        renderComponent({ member: memberWithJoinMembership });
        expect(screen.getByText(/remove from space/i)).toBeInTheDocument();
        cleanup();

        renderComponent({ member: memberWithInviteMembership });
        expect(screen.getByText(/disinvite from space/i)).toBeInTheDocument();
        cleanup();
        mockRoom.isSpaceRoom.mockReturnValue(false);
    });

    it("clicking the kick button calls Modal.createDialog with the correct arguments", async () => {
        createDialogSpy.mockReturnValueOnce({ finished: Promise.resolve([]), close: jest.fn() });

        renderComponent({ room: mockSpace, member: memberWithInviteMembership });
        await userEvent.click(screen.getByText(/disinvite from/i));

        // check the last call arguments and the presence of the spaceChildFilter callback
        expect(createDialogSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            expect.objectContaining({ spaceChildFilter: expect.any(Function) }),
            "mx_ConfirmSpaceUserActionDialog_wrapper",
        );

        // test the spaceChildFilter callback
        const callback = createDialogSpy.mock.lastCall[1].spaceChildFilter;

        // make dummy values for myMember and theirMember, then we will test
        // null vs their member followed by
        // my member vs their member
        const mockMyMember = { powerLevel: 1 };
        const mockTheirMember = { membership: "invite", powerLevel: 0 };

        const mockRoom = {
            getMember: jest
                .fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTheirMember)
                .mockReturnValueOnce(mockMyMember)
                .mockReturnValueOnce(mockTheirMember),
            currentState: {
                hasSufficientPowerLevelFor: jest.fn().mockReturnValue(true),
            },
        };

        expect(callback(mockRoom)).toBe(null);
        expect(callback(mockRoom)).toBe(true);
    });
});

describe("<BanToggleButton />", () => {
    const defaultMember = new RoomMember(mockRoom.roomId, defaultUserId);
    const memberWithBanMembership = { ...defaultMember, membership: "ban" };

    const defaultProps = { room: mockRoom, member: defaultMember, startUpdating: jest.fn(), stopUpdating: jest.fn() };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<BanToggleButton {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    const createDialogSpy: jest.SpyInstance = jest.spyOn(Modal, "createDialog");

    afterEach(() => {
        createDialogSpy.mockReset();
    });

    it("renders the correct labels for banned and unbanned members", () => {
        // test for room
        // defaultMember is not banned
        renderComponent();
        expect(screen.getByText("Ban from room")).toBeInTheDocument();
        cleanup();

        renderComponent({ member: memberWithBanMembership });
        expect(screen.getByText("Unban from room")).toBeInTheDocument();
        cleanup();

        // test for space
        mockRoom.isSpaceRoom.mockReturnValue(true);
        renderComponent();
        expect(screen.getByText("Ban from space")).toBeInTheDocument();
        cleanup();

        renderComponent({ member: memberWithBanMembership });
        expect(screen.getByText("Unban from space")).toBeInTheDocument();
        cleanup();
        mockRoom.isSpaceRoom.mockReturnValue(false);
    });

    it("clicking the ban or unban button calls Modal.createDialog with the correct arguments if user is not banned", async () => {
        createDialogSpy.mockReturnValueOnce({ finished: Promise.resolve([]), close: jest.fn() });

        renderComponent({ room: mockSpace });
        await userEvent.click(screen.getByText(/ban from/i));

        // check the last call arguments and the presence of the spaceChildFilter callback
        expect(createDialogSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            expect.objectContaining({ spaceChildFilter: expect.any(Function) }),
            "mx_ConfirmSpaceUserActionDialog_wrapper",
        );

        // test the spaceChildFilter callback
        const callback = createDialogSpy.mock.lastCall[1].spaceChildFilter;

        // make dummy values for myMember and theirMember, then we will test
        // null vs their member followed by
        // truthy my member vs their member
        const mockMyMember = { powerLevel: 1 };
        const mockTheirMember = { membership: "is not ban", powerLevel: 0 };

        const mockRoom = {
            getMember: jest
                .fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTheirMember)
                .mockReturnValueOnce(mockMyMember)
                .mockReturnValueOnce(mockTheirMember),
            currentState: {
                hasSufficientPowerLevelFor: jest.fn().mockReturnValue(true),
            },
        };

        expect(callback(mockRoom)).toBe(null);
        expect(callback(mockRoom)).toBe(true);
    });

    it("clicking the ban or unban button calls Modal.createDialog with the correct arguments if user _is_ banned", async () => {
        createDialogSpy.mockReturnValueOnce({ finished: Promise.resolve([]), close: jest.fn() });

        renderComponent({ room: mockSpace, member: memberWithBanMembership });
        await userEvent.click(screen.getByText(/ban from/i));

        // check the last call arguments and the presence of the spaceChildFilter callback
        expect(createDialogSpy).toHaveBeenLastCalledWith(
            expect.any(Function),
            expect.objectContaining({ spaceChildFilter: expect.any(Function) }),
            "mx_ConfirmSpaceUserActionDialog_wrapper",
        );

        // test the spaceChildFilter callback
        const callback = createDialogSpy.mock.lastCall[1].spaceChildFilter;

        // make dummy values for myMember and theirMember, then we will test
        // null vs their member followed by
        // my member vs their member
        const mockMyMember = { powerLevel: 1 };
        const mockTheirMember = { membership: "ban", powerLevel: 0 };

        const mockRoom = {
            getMember: jest
                .fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTheirMember)
                .mockReturnValueOnce(mockMyMember)
                .mockReturnValueOnce(mockTheirMember),
            currentState: {
                hasSufficientPowerLevelFor: jest.fn().mockReturnValue(true),
            },
        };

        expect(callback(mockRoom)).toBe(null);
        expect(callback(mockRoom)).toBe(true);
    });
});

describe("<RoomAdminToolsContainer />", () => {
    const defaultMember = new RoomMember(mockRoom.roomId, defaultUserId);
    defaultMember.membership = "invite";

    const defaultProps = {
        room: mockRoom,
        member: defaultMember,
        startUpdating: jest.fn(),
        stopUpdating: jest.fn(),
        powerLevels: {},
    };

    const renderComponent = (props = {}) => {
        const Wrapper = (wrapperProps = {}) => {
            return <MatrixClientContext.Provider value={mockClient} {...wrapperProps} />;
        };

        return render(<RoomAdminToolsContainer {...defaultProps} {...props} />, {
            wrapper: Wrapper,
        });
    };

    it("returns a single empty div if room.getMember is falsy", () => {
        const { asFragment } = renderComponent();
        expect(asFragment()).toMatchInlineSnapshot(`
            <DocumentFragment>
              <div />
            </DocumentFragment>
        `);
    });

    it("can return a single empty div in case where room.getMember is not falsy", () => {
        mockRoom.getMember.mockReturnValueOnce(defaultMember);
        const { asFragment } = renderComponent();
        expect(asFragment()).toMatchInlineSnapshot(`
            <DocumentFragment>
              <div />
            </DocumentFragment>
        `);
    });

    it("returns kick, redact messages, ban buttons if conditions met", () => {
        const mockMeMember = new RoomMember(mockRoom.roomId, "arbitraryId");
        mockMeMember.powerLevel = 51; // defaults to 50
        mockRoom.getMember.mockReturnValueOnce(mockMeMember);

        const defaultMemberWithPowerLevel = { ...defaultMember, powerLevel: 0 };

        renderComponent({ member: defaultMemberWithPowerLevel });

        expect(screen.getByRole("heading", { name: /admin tools/i })).toBeInTheDocument();
        expect(screen.getByText(/disinvite from room/i)).toBeInTheDocument();
        expect(screen.getByText(/ban from room/i)).toBeInTheDocument();
        expect(screen.getByText(/remove recent messages/i)).toBeInTheDocument();
    });

    it("returns mute toggle button if conditions met", () => {
        const mockMeMember = new RoomMember(mockRoom.roomId, "arbitraryId");
        mockMeMember.powerLevel = 51; // defaults to 50
        mockRoom.getMember.mockReturnValueOnce(mockMeMember);

        const defaultMemberWithPowerLevelAndJoinMembership = { ...defaultMember, powerLevel: 0, membership: "join" };

        renderComponent({
            member: defaultMemberWithPowerLevelAndJoinMembership,
            powerLevels: { events: { "m.room.power_levels": 1 } },
        });

        expect(screen.getByText(/mute/i)).toBeInTheDocument();
    });
});

describe("disambiguateDevices", () => {
    it("does not add ambiguous key to unique names", () => {
        const initialDevices = [
            { deviceId: "id1", getDisplayName: () => "name1" } as DeviceInfo,
            { deviceId: "id2", getDisplayName: () => "name2" } as DeviceInfo,
            { deviceId: "id3", getDisplayName: () => "name3" } as DeviceInfo,
        ];
        disambiguateDevices(initialDevices);

        // mutates input so assert against initialDevices
        initialDevices.forEach((device) => {
            expect(device).not.toHaveProperty("ambiguous");
        });
    });

    it("adds ambiguous key to all ids with non-unique names", () => {
        const uniqueNameDevices = [
            { deviceId: "id3", getDisplayName: () => "name3" } as DeviceInfo,
            { deviceId: "id4", getDisplayName: () => "name4" } as DeviceInfo,
            { deviceId: "id6", getDisplayName: () => "name6" } as DeviceInfo,
        ];
        const nonUniqueNameDevices = [
            { deviceId: "id1", getDisplayName: () => "nonUnique" } as DeviceInfo,
            { deviceId: "id2", getDisplayName: () => "nonUnique" } as DeviceInfo,
            { deviceId: "id5", getDisplayName: () => "nonUnique" } as DeviceInfo,
        ];
        const initialDevices = [...uniqueNameDevices, ...nonUniqueNameDevices];
        disambiguateDevices(initialDevices);

        // mutates input so assert against initialDevices
        uniqueNameDevices.forEach((device) => {
            expect(device).not.toHaveProperty("ambiguous");
        });
        nonUniqueNameDevices.forEach((device) => {
            expect(device).toHaveProperty("ambiguous", true);
        });
    });
});

describe("isMuted", () => {
    // this member has a power level of 0
    const isMutedMember = new RoomMember(mockRoom.roomId, defaultUserId);

    it("returns false if either argument is falsy", () => {
        // @ts-ignore to let us purposely pass incorrect args
        expect(isMuted(isMutedMember, null)).toBe(false);
        // @ts-ignore to let us purposely pass incorrect args
        expect(isMuted(null, {})).toBe(false);
    });

    it("when powerLevelContent.events and .events_default are undefined, returns false", () => {
        const powerLevelContents = {};
        expect(isMuted(isMutedMember, powerLevelContents)).toBe(false);
    });

    it("when powerLevelContent.events is undefined, uses .events_default", () => {
        const higherPowerLevelContents = { events_default: 10 };
        expect(isMuted(isMutedMember, higherPowerLevelContents)).toBe(true);

        const lowerPowerLevelContents = { events_default: -10 };
        expect(isMuted(isMutedMember, lowerPowerLevelContents)).toBe(false);
    });

    it("when powerLevelContent.events is defined but '.m.room.message' isn't, uses .events_default", () => {
        const higherPowerLevelContents = { events: {}, events_default: 10 };
        expect(isMuted(isMutedMember, higherPowerLevelContents)).toBe(true);

        const lowerPowerLevelContents = { events: {}, events_default: -10 };
        expect(isMuted(isMutedMember, lowerPowerLevelContents)).toBe(false);
    });

    it("when powerLevelContent.events and '.m.room.message' are defined, uses the value", () => {
        const higherPowerLevelContents = { events: { "m.room.message": -10 }, events_default: 10 };
        expect(isMuted(isMutedMember, higherPowerLevelContents)).toBe(false);

        const lowerPowerLevelContents = { events: { "m.room.message": 10 }, events_default: -10 };
        expect(isMuted(isMutedMember, lowerPowerLevelContents)).toBe(true);
    });
});

describe("getPowerLevels", () => {
    it("returns an empty object when room.currentState.getStateEvents return null", () => {
        mockRoom.currentState.getStateEvents.mockReturnValueOnce(null);
        expect(getPowerLevels(mockRoom)).toEqual({});
    });
});
