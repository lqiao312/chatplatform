import { createApp, Transition, TransitionGroup } from 'vue';
// import { GraffitiRemote } from "@graffiti-garden/implementation/remote";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";

const UsernameDisplay = {
  props: ["actor"],
  computed: {
    username() {
      try {
        const { pathname } = new URL(this.actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : this.actor;
      } catch {
        const m = this.actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : this.actor;
      }
    },
  },
  template: `<span class="username">@{{ username }}</span>`,
};

const app = createApp({
  data() {
    return {
      groups: [],
      groupOperations: {
        loading: false,
        error: null,
        lastUpdated: null
      },

      newGroupName: "",
      editGroupName: "",
      currentGroup: null,
      selectedGroupObject: null,
      groupNameOverride: null,
      channels: ["designftw"],

      myMessage: "",
      editingMessage: null,
      editedContent: "",

      showProfileEditor: false,
      profile: {
        name: "",
        pronouns: "",
        loaded: false,
        error: null,
      },

      savedProfile: {
        name: '',
        pronouns: '',
        published: null
      },

      hasSavedProfile: false,

      isRecording: false,
      recorder:    null,
      chunks:      [],
      openMenuFor: null,
      transcripts: {},

      volume: 1,
      playbackRate: 1,
      showAudioPopup: false,
      popupAudioUrl: null,

      likedMessages: new Set(),
      expandedMessages: new Set(),
    };
  },

  computed: {
    groupName() {
      if (this.groupNameOverride) return this.groupNameOverride.name;
      return this.selectedGroupObject?.value?.object?.name || "Unnamed Group";
    },

    createSchema() {
      return {
        properties: {
          value: {
            required: ["activity", "object", "published"],
            properties: {
              activity: { const: "Create" },
              object: {
                required: ["type", "name", "channel"],
                properties: {
                  type: { const: "Group Chat" },
                  name: { type: "string" },
                  channel: { type: "string" },
                },
              },
              published: { type: "number" }
            },
          },
        },
      };
    },

    msgSchema() {
      return {
        properties: {
          value: {
            required: ["published"],
            properties: {
              content: { type: "string" },
              audio: { type: "string" },
              published: { type: "number" },
              likes: { type: "array" }
            }
          }
        }
      };
    },

    username() {
      const actor = this.$graffitiSession?.value?.actor ?? "";
      try {
        const { pathname } = new URL(actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : actor;
      } catch {
        const m = actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : actor;
      }
    },

    groupName() {
      if (this.groupNameOverride) return this.groupNameOverride.name;
      return this.selectedGroupObject?.value?.object?.name ?? "Unnamed Group";
    },

    sortedGroups() {
      const all = this.$graffiti.state || [];
      return all
        .filter(o =>
          o.channels?.includes("designftw") &&
          o.value.activity === "Create" &&
          o.value.object?.type === "Group Chat"
        )
        .sort((a, b) => b.value.published - a.value.published);
    },
  },

  methods: {
    // startLogin() {
    //   const redirect = window.location.origin + window.location.pathname;
    //   this.$graffiti.login({
    //     oidcIssuer:  'https://broker.pod.inrupt.com/',
    //     clientName:  'DesignFTW Chat',
    //     redirectUrl: redirect
    //   });
    // },
    startLogin() {
      this.$graffiti.login({
        actor: `local-user-${Math.random().toString(36).substring(2, 9)}`,
        name: 'Local User'
      });
    },

    shouldTruncate(content) {
      return content && content.length > 10;
    },
    
    isExpanded(message) {
      return this.expandedMessages.has(message.url);
    },
    
    toggleMessageExpand(message) {
      if (!this.shouldTruncate(message.value.content)) return;
      
      if (this.isExpanded(message)) {
        this.expandedMessages.delete(message.url);
      } else {
        this.expandedMessages.add(message.url);
      }
    },
    
    truncateGroupName(name) {
      const maxLength = 15; // Increased from 10 for better visibility
      return name.length > maxLength ? `${name.substring(0, maxLength)}...` : name;
    },

    handleAudioError(message) {
      if (message && message.value) {
        message.value.audioError = true;
      }
    },

    async startRecording() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Audio recording not supported in your browser");
        return;
      }
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.chunks = [];
        this.recorder = new MediaRecorder(stream);
        this.recorder.ondataavailable = e => {
          this.chunks.push(e.data);
        };
        this.recorder.start();
        this.isRecording = true;
      } catch (err) {
        alert("Couldn't start recording: " + err.message);
      }
    },

    async stopRecording() {
      return new Promise(resolve => {
        this.recorder.onstop = async () => {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          await this.sendAudioMessage(blob);
          this.isRecording = false;
          resolve();
        };
        this.recorder.stop();
      });
    },

    async sendAudioMessage(blob) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        const session = this.$graffitiSession.value;
        if (!session) return;
      
        await this.$graffiti.put(
          {
            value: { audio: dataUrl, published: Date.now() },
            channels: this.channels
          },
          session
        );
      };
      reader.readAsDataURL(blob);
    },

    toggleMenu(msg) {
      this.openMenuFor = this.openMenuFor === msg ? null : msg;
    },

    async downloadMessage(msg) {
      if (!msg.value.audio) return;
      const a = document.createElement('a');
      a.href = msg.value.audio;
      const id = msg.url.split('/').pop() || msg.value.published;
      a.download = `audio-${id}.webm`;
      a.click();
      this.openMenuFor = null;

      if (this.$graffitiSession.value) {
        const liked = await this.$graffiti.discover({
          channels: this.channels,
          schema: {
            properties: {
              value: {
                properties: {
                  likes: { contains: { const: this.$graffitiSession.value.actor } }
                }
              }
            }
          }
        });
        liked.forEach(msg => this.likedMessages.add(msg.url));
      }
    },

    async transcriptMessage(m) {
       if (!m.value.audio) return;
       try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: m.value.audio })
        });
        const body = await res.json();
        this.transcripts[m.url] = body.transcript;
      } catch (err) {
        alert('Sorry, could not generate transcript.');
      }
    },

    openAudioPopup(src) {
      if (!src) {
        console.error('No audio source provided');
        return;
      }
      
      console.log('Opening audio popup with src:', src.substring(0, 50) + '...');
      this.popupAudioUrl = src;
      this.showAudioPopup = true;
      
      this.$nextTick(() => {
        const audioEl = this.$refs.popupAudio;
        if (audioEl) {
          audioEl.currentTime = 0;
          audioEl.volume = Math.max(0, Math.min(1, this.volume));
          audioEl.playbackRate = Math.max(0.5, Math.min(2, this.playbackRate));
          audioEl.play().catch(error => {
            console.error("Audio playback failed:", error);
            this.handleAudioError({ value: { audioError: true } });
          });
        }
      });
    },
    
    closeAudioPopup() {
      const audioEl = this.$refs.popupAudio;
      if (audioEl) {
        audioEl.pause();
        audioEl.currentTime = 0;
      }
      this.showAudioPopup = false;
      this.popupAudioUrl = null;
    },
    
    handleAudioError(message) {
      if (message && message.value) {
        message.value.audioError = true;
      }
    },

    changeSpeed() {
      if (this.$refs.popupAudio) {
        const safePlaybackRate = Math.max(0.5, Math.min(2, this.playbackRate));
        this.$refs.popupAudio.playbackRate = safePlaybackRate;
      }
    },

    onLoaded() {
      this.duration = this.$refs.popupAudio.duration;
    },

    handleTransitionEnter(el, done) {
      done();
    },

    handleTransitionLeave(el, done) {
      done();
    },

    formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },

    async createGroupChat(session) {
      try {
        const name = this.newGroupName.trim();
        if (!name) {
          alert("Please enter a group name");
          return;
        }
    
        const newGroup = {
          value: {
            activity: "Create",
            object: { 
              type: "Group Chat", 
              name, 
              channel: crypto.randomUUID() 
            },
            published: Date.now(),
          },
          channels: ["designftw"],
        };
    
        await this.$graffiti.put(newGroup, session);
    
        this.newGroupName = "";
    
        await this.refreshGroups();
    
        this.enterGroup(newGroup);
    
      } catch (error) {
        alert("Failed to create group. Please try again.");
      }
    },

    async refreshGroups() {
      try {
        const response = await this.$graffiti.get({
          channels: ["designftw"],
          schema: this.createSchema
        });
        
        this.groups = response
          .filter(item => item?.value?.activity === "Create")
          .sort((a, b) => b.value.published - a.value.published);
        
      } catch (error) {
        this.groupOperations.error = "Failed to load groups";
      }
    },

    enterGroup(group) {
      const groupObj = group.value ? group.value.object : group;
      this.currentGroup = groupObj.channel;
      this.selectedGroupObject = group;
      this.channels = [groupObj.channel];
      this.editGroupName = groupObj.name;
    },

    formatDate(date) {
      return new Date(date).toLocaleString();
    },

    async setGroupNameOverride(session) {
      try {
        this.groupOperations.loading = true;
        this.groupOperations.error = null;
        
        const name = this.editGroupName.trim();
        if (!name || !this.currentGroup) {
          this.groupOperations.error = "Invalid input";
          return;
        }
    
        if (this.selectedGroupObject) {
          this.selectedGroupObject.value.object.name = name;
          this.groupNameOverride = { name };
        }
    
        const groupIndex = this.groups.findIndex(
          g => g?.value?.object?.channel === this.currentGroup
        );
    
        if (groupIndex !== -1) {
          const updatedGroup = {
            ...this.groups[groupIndex],
            value: {
              ...this.groups[groupIndex].value,
              object: {
                ...this.groups[groupIndex].value.object,
                name: name
              }
            }
          };
    
          this.groups.splice(groupIndex, 1, updatedGroup);
          
          await this.$graffiti.put(updatedGroup, session);
          
          this.$emit('show-notification', 'Group name updated successfully');
        }
    
        this.editGroupName = "";
        
      } catch (error) {
        this.groupOperations.error = "Failed to update group name";
      } finally {
        this.groupOperations.loading = false;
      }
    },

    exitGroup() {
      this.currentGroup = null;
      this.channels = ["designftw"];
    },

    async sendMessage() {
      const text = this.myMessage.trim();
      if (!text) return;

      const session = this.$graffitiSession?.value;
      if (!session) return;
  
      await this.$graffiti.put(
        {
          value: { content: text, published: Date.now() },
          channels: this.channels
        },
         session
      );
  
      this.myMessage = "";
    },

    async deleteMessage(message, session) {
      await this.$graffiti.delete(message, session);
    },

    async editMessage(message, newContent, session) {
      const content = newContent.trim();
      if (!content) return;
      await this.$graffiti.patch(
        { value: [{ op: "replace", path: "/content", value: content }] },
        message,
        session
      );
      this.editingMessage = null;
      this.editedContent = "";
    },

    scrollToProfile() {
      const section = document.getElementById("profile-editor");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },

    openProfile() {
        this.showProfileEditor = true;
        this.$nextTick(() => {
        this.scrollToProfile();
      });
    },

    formatMessageTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    async confirmDeleteGroup(group) {
      if (confirm(`Are you sure you want to delete "${group.value.object.name}"? This cannot be undone.`)) {
        try {
          await this.$graffiti.delete(group, this.$graffitiSession.value);
          this.refreshGroups();
          if (this.currentGroup === group.value.object.channel) {
            this.exitGroup();
          }
        } catch (error) {
          alert("Failed to delete group: " + error.message);
        }
      }
    },

    async saveProfile() {
      try {
        this.profile.loading = true;
        this.profile.error = null;
        
        const session = this.$graffitiSession?.value;
        if (!session) throw new Error("Not authenticated");
  
        const name = this.profile.name.trim();
        const pronouns = this.profile.pronouns.trim();
  
        if (!name) throw new Error("Name is required");
  
        const profileObj = {
          type: "Profile",
          name: name,
          pronouns: pronouns,
          published: new Date().toISOString()
        };
  
        await this.$graffiti.put({
          value: profileObj,
          channels: [session.actor]
        }, session);
  
        this.savedProfile = {
          name: name,
          pronouns: pronouns,
          published: profileObj.published
        };
        this.hasSavedProfile = true;
  
        this.profile.name = "";
        this.profile.pronouns = "";
        
      } catch (error) {
        this.profile.error = error.message;
      } finally {
        this.profile.loading = false;
      }
    },
      
    async loadProfile() {
      try {
        const session = this.$graffitiSession?.value;
        if (!session) return;
  
        const results = await this.$graffiti.discover({
          channels: [session.actor],
          schema: {
            properties: {
              value: {
                properties: {
                  type: { const: "Profile" }
                }
              }
            }
          }
        });
  
        if (results.length > 0) {
          const latest = results.sort((a, b) => 
            new Date(b.value.published) - new Date(a.value.published)
          )[0];
          
          this.savedProfile = {
            name: latest.value.name || "",
            pronouns: latest.value.pronouns || "",
            published: latest.value.published
          };
          this.hasSavedProfile = true;
          
          this.profile.name = this.savedProfile.name;
          this.profile.pronouns = this.savedProfile.pronouns;
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      }
    },
  
    formatProfileDate(dateString) {
      return new Date(dateString).toLocaleString();
    }
  },

  watch: {
    selectedGroupObject: {
      handler(newGroup) {
        if (newGroup) {
          this.editGroupName = newGroup.value.object.name;
        }
      },
      immediate: true
    },

    "$graffitiSession.value": {
      handler(session) {
        if (session) {
          this.loadProfile();
        } else {
          this.profile = {
            name: "",
            pronouns: "",
            loading: false,
            error: null
          };
        }
      },
      immediate: true
    }
  },
})

app.component('Transition', Transition);
app.component('TransitionGroup', TransitionGroup);

app.component("username-display", UsernameDisplay)
.use(GraffitiPlugin, {
  graffiti: new GraffitiLocal(),
  // graffiti: new GraffitiRemote(),
})
.mount("#app");